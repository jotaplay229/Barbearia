import { json, method, safeString } from '../lib/http.js';
import { requireOwnerBarbearia } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { normalizeAgendamento, normalizeBarbearia, serviceForBarber, storeMetaDescription } from '../lib/db-compat.js';

const CANCELLED = new Set(['cancelado', 'recusado', 'cancelado_cliente']);
const PAID = new Set(['pago']);

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function cents(value) {
  if (typeof value === 'number') return Math.round(value);
  const raw = String(value || '0').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  return Math.round(Number(raw || 0) * 100);
}

function cleanFinance(finance = {}) {
  const lancamentos = Array.isArray(finance.lancamentos) ? finance.lancamentos : [];
  return {
    lancamentos: lancamentos.map(item => ({
      id: safeString(item.id) || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      tipo: item.tipo === 'saida' ? 'saida' : 'entrada',
      data: /^\d{4}-\d{2}-\d{2}$/.test(safeString(item.data)) ? safeString(item.data) : todayIso(),
      descricao: safeString(item.descricao) || 'Lancamento',
      categoria: safeString(item.categoria) || (item.tipo === 'saida' ? 'Despesa' : 'Receita'),
      valor_cents: Math.max(0, Number(item.valor_cents || 0)),
      status: item.status === 'pendente' ? 'pendente' : 'pago',
      forma: safeString(item.forma),
      observacao: safeString(item.observacao)
    }))
  };
}

function activeAppointment(ag) {
  return !CANCELLED.has(String(ag.status || '').toLowerCase());
}

function paidAppointment(ag) {
  return PAID.has(String(ag.status || '').toLowerCase());
}

function monthOf(date) {
  return Number(String(date || '').slice(5, 7));
}

function sum(items, pick = item => item.valor_cents) {
  return items.reduce((acc, item) => acc + Number(pick(item) || 0), 0);
}

function groupTop(items, keyFn, valueFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item) || 'Sem categoria';
    const old = map.get(key) || { nome: key, quantidade: 0, valor_cents: 0 };
    old.quantidade += 1;
    old.valor_cents += Number(valueFn(item) || 0);
    map.set(key, old);
  }
  return [...map.values()].sort((a, b) => b.valor_cents - a.valor_cents).slice(0, 8);
}

async function saveFinance(loja, finance) {
  const descricao = storeMetaDescription({
    descricao: loja.descricao,
    horarios_custom: loja.horarios_custom,
    financeiro: finance
  });
  const { error } = await supabaseAdmin
    .from('barbearias')
    .update({ descricao })
    .eq('id', loja.id);
  if (error) throw error;
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;
  try {
    const { barbearia } = await requireOwnerBarbearia(req);
    const loja = normalizeBarbearia(barbearia);
    const finance = cleanFinance(loja.financeiro);

    if (req.method === 'POST') {
      const body = req.body || {};
      const lancamento = {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        tipo: body.tipo === 'saida' ? 'saida' : 'entrada',
        data: /^\d{4}-\d{2}-\d{2}$/.test(safeString(body.data)) ? safeString(body.data) : todayIso(),
        descricao: safeString(body.descricao) || 'Lancamento',
        categoria: safeString(body.categoria) || (body.tipo === 'saida' ? 'Despesa' : 'Receita'),
        valor_cents: Math.max(0, cents(body.valor_cents ?? body.valor)),
        status: body.status === 'pendente' ? 'pendente' : 'pago',
        forma: safeString(body.forma),
        observacao: safeString(body.observacao)
      };
      finance.lancamentos = [lancamento, ...finance.lancamentos].slice(0, 600);
      await saveFinance(loja, finance);
      return json(res, 201, { sucesso: true, lancamento });
    }

    if (req.method === 'DELETE') {
      const id = safeString(req.query.id || req.body?.id);
      if (!id) return json(res, 400, { erro: 'ID obrigatorio.' });
      finance.lancamentos = finance.lancamentos.filter(item => item.id !== id);
      await saveFinance(loja, finance);
      return json(res, 200, { sucesso: true });
    }

    const now = new Date();
    const ano = Math.max(2020, Number(req.query.ano || now.getFullYear()));
    const mes = Math.min(12, Math.max(1, Number(req.query.mes || now.getMonth() + 1)));
    const start = `${ano}-01-01`;
    const end = `${ano}-12-31`;

    const { data: rows, error } = await supabaseAdmin
      .from('agendamentos')
      .select('*,clientes(nome,telefone),servicos(*),barbeiros(nome)')
      .eq('barbearia_id', loja.id)
      .gte('data_agendamento', start)
      .lte('data_agendamento', end)
      .order('data_agendamento')
      .order('hora_inicio');
    if (error) throw error;

    const agendamentos = (rows || []).map(a => {
      const view = normalizeAgendamento(a);
      const servico = serviceForBarber(a.servicos || {}, a.barbeiro_id);
      return {
        ...view,
        servicos: servico,
        valor_cents: Number(servico.preco_cents || 0)
      };
    });
    const agsAtivos = agendamentos.filter(activeAppointment);
    const agsPagos = agsAtivos.filter(paidAppointment);
    const agsMes = agsPagos.filter(ag => monthOf(ag.data_agendamento) === mes);

    const manuaisAno = finance.lancamentos.filter(item => String(item.data).startsWith(String(ano)));
    const manuaisMes = manuaisAno.filter(item => monthOf(item.data) === mes);
    const pagosMes = manuaisMes.filter(item => item.status !== 'pendente');
    const pagosAno = manuaisAno.filter(item => item.status !== 'pendente');
    const entradasMes = sum(agsMes, item => item.valor_cents) + sum(pagosMes.filter(item => item.tipo === 'entrada'));
    const saidasMes = sum(pagosMes.filter(item => item.tipo === 'saida'));
    const entradasAno = sum(agsPagos, item => item.valor_cents) + sum(pagosAno.filter(item => item.tipo === 'entrada'));
    const saidasAno = sum(pagosAno.filter(item => item.tipo === 'saida'));
    const pendentes = manuaisAno.filter(item => item.status === 'pendente');

    const meses = Array.from({ length: 12 }, (_, index) => {
      const m = index + 1;
      const ags = agsPagos.filter(ag => monthOf(ag.data_agendamento) === m);
      const movs = manuaisAno.filter(item => monthOf(item.data) === m && item.status !== 'pendente');
      const entradas = sum(ags, item => item.valor_cents) + sum(movs.filter(item => item.tipo === 'entrada'));
      const saidas = sum(movs.filter(item => item.tipo === 'saida'));
      return { mes: m, entradas_cents: entradas, saidas_cents: saidas, lucro_cents: entradas - saidas, agendamentos: ags.length };
    });

    return json(res, 200, {
      sucesso: true,
      periodo: { mes, ano },
      resumo: {
        entradas_mes_cents: entradasMes,
        saidas_mes_cents: saidasMes,
        lucro_mes_cents: entradasMes - saidasMes,
        entradas_ano_cents: entradasAno,
        saidas_ano_cents: saidasAno,
        lucro_ano_cents: entradasAno - saidasAno,
        agendamentos_mes: agsMes.length,
        agendamentos_ano: agsPagos.length,
        contas_pendentes_cents: sum(pendentes)
      },
      meses,
      agendamentos_mes: agsMes,
      agendamentos_ano: agsPagos,
      lancamentos_mes: manuaisMes,
      lancamentos_ano: manuaisAno,
      contas_pendentes: pendentes,
      top_servicos_mes: groupTop(agsMes, ag => ag.servicos?.nome || ag.servico_nome, ag => ag.valor_cents),
      top_servicos_ano: groupTop(agsPagos, ag => ag.servicos?.nome || ag.servico_nome, ag => ag.valor_cents),
      categorias_saida: groupTop(manuaisAno.filter(item => item.tipo === 'saida'), item => item.categoria, item => item.valor_cents),
      categorias_entrada: groupTop(manuaisAno.filter(item => item.tipo === 'entrada'), item => item.categoria, item => item.valor_cents)
    });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
