import { isValidMobilePhoneBR, json, method, normalizePhoneBR, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireOwnerBarbearia } from '../lib/auth.js';
import { sendText } from '../lib/evolution.js';
import { msgClienteCancelamentoConfirmado, msgClienteConfirmado } from '../lib/messages.js';
import {
  normalizeAgendamento,
  normalizeBarbearia,
  serviceForBarber,
  storeMetaDescription,
  whatsappLogPayload
} from '../lib/db-compat.js';

const CANCELLED = new Set(['cancelado', 'cancelado_cliente', 'recusado']);

function toMinutes(t) {
  const [h, m] = String(t || '00:00').split(':').map(Number);
  return h * 60 + m;
}

function toTime(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function cleanFinance(finance = {}) {
  const lancamentos = Array.isArray(finance.lancamentos) ? finance.lancamentos : [];
  const agendamentosPagos = Array.isArray(finance.agendamentos_pagos) ? finance.agendamentos_pagos : [];
  return {
    ...finance,
    lancamentos,
    agendamentos_pagos: agendamentosPagos
      .map(item => typeof item === 'string' ? { agendamento_id: item } : {
        agendamento_id: safeString(item.agendamento_id || item.id),
        pago_em: safeString(item.pago_em || item.paid_at),
        forma: safeString(item.forma)
      })
      .filter(item => item.agendamento_id)
  };
}

function paidIds(loja) {
  return new Set(cleanFinance(loja.financeiro).agendamentos_pagos.map(item => String(item.agendamento_id)));
}

function withPaidFlag(row, paidSet) {
  const view = normalizeAgendamento(row);
  return {
    ...view,
    financeiro_pago: paidSet.has(String(view.id))
  };
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

async function markPaid(loja, agendamentoId) {
  const finance = cleanFinance(loja.financeiro);
  const id = String(agendamentoId);
  if (!finance.agendamentos_pagos.some(item => String(item.agendamento_id) === id)) {
    finance.agendamentos_pagos.unshift({
      agendamento_id: id,
      pago_em: new Date().toISOString()
    });
    finance.agendamentos_pagos = finance.agendamentos_pagos.slice(0, 1200);
    await saveFinance(loja, finance);
    loja.financeiro = finance;
  }
}

async function unmarkPaid(loja, agendamentoId) {
  const finance = cleanFinance(loja.financeiro);
  const id = String(agendamentoId);
  const before = finance.agendamentos_pagos.length;
  finance.agendamentos_pagos = finance.agendamentos_pagos.filter(item => String(item.agendamento_id) !== id);
  if (finance.agendamentos_pagos.length !== before) {
    await saveFinance(loja, finance);
    loja.financeiro = finance;
  }
}

async function activeWhatsapp(lojaId) {
  const { data } = await supabaseAdmin
    .from('barbearia_whatsapp')
    .select('*')
    .eq('barbearia_id', lojaId)
    .eq('ativo', true)
    .maybeSingle();
  return data;
}

function isInvalidWhatsappNumberError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('exists') && msg.includes('false');
}

async function notifyClient({ loja, ag, tipo }) {
  const whats = await activeWhatsapp(loja.id);
  if (!whats) return { ok: false, erro: 'WhatsApp da barbearia nao configurado.' };

  const agView = normalizeAgendamento(ag);
  const base = {
    barbearia: loja,
    cliente_nome: agView.cliente_nome,
    servico_nome: agView.servicos?.nome || 'Servico',
    data_agendamento: agView.data_agendamento,
    hora_inicio: String(agView.hora_inicio).slice(0, 5)
  };
  const texto = tipo === 'cancelado'
    ? msgClienteCancelamentoConfirmado(base)
    : msgClienteConfirmado(base);
  const logTipo = tipo === 'cancelado' ? 'cliente_cancelado' : 'cliente_confirmado';

  try {
    const retorno = await sendText({
      apiUrl: whats.evolution_api_url,
      apiKey: whats.evolution_api_key,
      instanceName: whats.instance_name,
      number: agView.cliente_whatsapp,
      text: texto
    });
    await supabaseAdmin.from('whatsapp_logs').insert(whatsappLogPayload({
      barbearia_id: loja.id,
      agendamento_id: ag.id,
      destino: agView.cliente_whatsapp,
      tipo: logTipo,
      texto,
      status: 'enviado',
      retorno
    }));
    return { ok: true };
  } catch (err) {
    await supabaseAdmin.from('whatsapp_logs').insert(whatsappLogPayload({
      barbearia_id: loja.id,
      agendamento_id: ag.id,
      destino: agView.cliente_whatsapp,
      tipo: logTipo,
      texto,
      status: 'erro',
      erro: err.message
    }));
    return { ok: false, invalidNumber: isInvalidWhatsappNumberError(err), erro: err.message };
  }
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'PATCH'])) return;
  try {
    const { barbearia } = await requireOwnerBarbearia(req);
    const loja = normalizeBarbearia(barbearia);

    if (req.method === 'GET') {
      const data = safeString(req.query.data) || new Date().toISOString().slice(0, 10);
      const from = safeString(req.query.from);
      const to = safeString(req.query.to);
      let query = supabaseAdmin
        .from('agendamentos')
        .select('*,clientes(nome,telefone),servicos(*),barbeiros(nome)')
        .eq('barbearia_id', loja.id);

      if (from || to) {
        query = query
          .gte('data_agendamento', from || data)
          .lte('data_agendamento', to || from || data)
          .order('data_agendamento')
          .order('hora_inicio');
      } else {
        query = query
          .eq('data_agendamento', data)
          .order('hora_inicio');
      }

      const { data: agendamentos, error } = await query;
      if (error) throw error;
      const paidSet = paidIds(loja);
      return json(res, 200, { agendamentos: (agendamentos || []).map(row => withPaidFlag(row, paidSet)) });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const cliente_nome = safeString(body.cliente_nome);
      const cliente_whatsapp = normalizePhoneBR(body.cliente_whatsapp);
      const servico_id = safeString(body.servico_id);
      const barbeiro_id = safeString(body.barbeiro_id) || null;
      const data_agendamento = safeString(body.data_agendamento);
      const hora_inicio = safeString(body.hora_inicio);
      const observacoes = safeString(body.observacoes);

      if (!cliente_nome || !cliente_whatsapp || !servico_id || !data_agendamento || !hora_inicio) {
        return json(res, 400, { erro: 'Preencha cliente, WhatsApp, servico, data e horario.' });
      }
      if (!isValidMobilePhoneBR(cliente_whatsapp)) {
        return json(res, 400, { erro: 'Digite um WhatsApp valido com DDD e 9 digitos.' });
      }

      const { data: servico, error: servicoError } = await supabaseAdmin
        .from('servicos')
        .select('*')
        .eq('id', servico_id)
        .eq('barbearia_id', loja.id)
        .maybeSingle();
      if (servicoError) throw servicoError;
      if (!servico) return json(res, 404, { erro: 'Servico nao encontrado.' });
      const servicoNorm = serviceForBarber(servico, barbeiro_id);
      if (servicoNorm.disponivel_para_barbeiro === false) {
        return json(res, 400, { erro: 'Esse servico nao esta disponivel para o profissional escolhido.' });
      }

      let barbeiro = null;
      if (barbeiro_id) {
        const { data: b, error: barbeiroError } = await supabaseAdmin
          .from('barbeiros')
          .select('id,nome')
          .eq('id', barbeiro_id)
          .eq('barbearia_id', loja.id)
          .maybeSingle();
        if (barbeiroError) throw barbeiroError;
        if (!b) return json(res, 404, { erro: 'Barbeiro nao encontrado.' });
        barbeiro = b;
      }

      let clienteId = null;
      const { data: clienteExistente } = await supabaseAdmin
        .from('clientes')
        .select('id')
        .eq('barbearia_id', loja.id)
        .eq('telefone', cliente_whatsapp)
        .maybeSingle();

      if (clienteExistente?.id) {
        clienteId = clienteExistente.id;
        await supabaseAdmin.from('clientes').update({ nome: cliente_nome }).eq('id', clienteId);
      } else {
        const { data: novoCliente, error: clienteError } = await supabaseAdmin
          .from('clientes')
          .insert({ barbearia_id: loja.id, nome: cliente_nome, telefone: cliente_whatsapp })
          .select('id')
          .single();
        if (clienteError) throw clienteError;
        clienteId = novoCliente.id;
      }

      const start = toMinutes(hora_inicio);
      const end = start + Number(servicoNorm.duracao_minutos || loja.intervalo_minutos || 30);
      const status = safeString(body.status);
      const { data: agendamento, error } = await supabaseAdmin
        .from('agendamentos')
        .insert({
          barbearia_id: loja.id,
          servico_id,
          barbeiro_id,
          cliente_id: clienteId,
          data_agendamento,
          hora_inicio,
          hora_fim: toTime(end),
          observacao: observacoes ? `[Encaixe] ${observacoes}` : '[Encaixe manual]',
          status: status === 'pago' ? 'confirmado' : status || 'confirmado'
        })
        .select('*,clientes(nome,telefone),servicos(*),barbeiros(nome)')
        .single();
      if (error) throw error;

      const agView = withPaidFlag({
        ...agendamento,
        clientes: { nome: cliente_nome, telefone: cliente_whatsapp },
        servicos: servicoNorm,
        barbeiros: barbeiro
      }, paidIds(loja));

      if ((status || 'confirmado') === 'confirmado') {
        const notify = await notifyClient({ loja, ag: { ...agendamento, clientes: { nome: cliente_nome, telefone: cliente_whatsapp }, servicos: servicoNorm }, tipo: 'confirmado' });
        if (notify?.invalidNumber) {
          await supabaseAdmin.from('agendamentos').update({ status: 'cancelado' }).eq('id', agendamento.id);
          return json(res, 400, { erro: 'Esse WhatsApp nao existe ou nao esta ativo. Confira o numero e tente novamente.' });
        }
      }

      return json(res, 201, {
        sucesso: true,
        agendamento: agView
      });
    }

    const id = safeString(req.query.id || req.body?.id);
    const status = safeString(req.body?.status);
    if (!id || !status) return json(res, 400, { erro: 'ID e status sao obrigatorios.' });

    if (status === 'pago') {
      const { data: ag, error } = await supabaseAdmin
        .from('agendamentos')
        .select('*,clientes(nome,telefone),servicos(*),barbeiros(nome)')
        .eq('id', id)
        .eq('barbearia_id', loja.id)
        .single();
      if (error) throw error;
      if (CANCELLED.has(String(ag.status || '').toLowerCase())) {
        return json(res, 400, { erro: 'Agendamento cancelado nao pode ser marcado como pago.' });
      }
      await markPaid(loja, id);
      return json(res, 200, { sucesso: true, agendamento: withPaidFlag(ag, paidIds(loja)) });
    }

    const { data: ag, error } = await supabaseAdmin
      .from('agendamentos')
      .update({ status })
      .eq('id', id)
      .eq('barbearia_id', loja.id)
      .select('*,clientes(nome,telefone),servicos(*),barbeiros(nome)')
      .single();
    if (error) throw error;

    if (CANCELLED.has(status)) {
      await unmarkPaid(loja, id);
      await notifyClient({ loja, ag, tipo: 'cancelado' });
    } else if (status === 'confirmado') {
      await notifyClient({ loja, ag, tipo: 'confirmado' });
    }

    return json(res, 200, { sucesso: true, agendamento: withPaidFlag(ag, paidIds(loja)) });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
