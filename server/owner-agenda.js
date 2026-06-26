import { json, method, normalizePhoneBR, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireOwnerBarbearia } from '../lib/auth.js';
import { sendText } from '../lib/evolution.js';
import { msgClienteConfirmado } from '../lib/messages.js';
import { normalizeAgendamento, normalizeBarbearia, normalizeServico, whatsappLogPayload } from '../lib/db-compat.js';

function toMinutes(t) {
  const [h, m] = String(t || '00:00').split(':').map(Number);
  return h * 60 + m;
}

function toTime(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'PATCH'])) return;
  try {
    const { barbearia } = await requireOwnerBarbearia(req);
    const loja = normalizeBarbearia(barbearia);

    if (req.method === 'GET') {
      const data = safeString(req.query.data) || new Date().toISOString().slice(0, 10);
      const { data: agendamentos, error } = await supabaseAdmin
        .from('agendamentos')
        .select('*,clientes(nome,telefone),servicos(*),barbeiros(nome)')
        .eq('barbearia_id', loja.id)
        .eq('data_agendamento', data)
        .order('hora_inicio');
      if (error) throw error;
      return json(res, 200, { agendamentos: (agendamentos || []).map(normalizeAgendamento) });
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

      const { data: servico, error: servicoError } = await supabaseAdmin
        .from('servicos')
        .select('*')
        .eq('id', servico_id)
        .eq('barbearia_id', loja.id)
        .maybeSingle();
      if (servicoError) throw servicoError;
      if (!servico) return json(res, 404, { erro: 'Servico nao encontrado.' });
      const servicoNorm = normalizeServico(servico);

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
          status: safeString(body.status) || 'confirmado'
        })
        .select('*,clientes(nome,telefone),servicos(*),barbeiros(nome)')
        .single();
      if (error) throw error;

      return json(res, 201, {
        sucesso: true,
        agendamento: normalizeAgendamento({
          ...agendamento,
          clientes: { nome: cliente_nome, telefone: cliente_whatsapp },
          servicos: servicoNorm,
          barbeiros: barbeiro
        })
      });
    }

    const id = safeString(req.query.id || req.body?.id);
    const status = safeString(req.body?.status);
    if (!id || !status) return json(res, 400, { erro: 'ID e status são obrigatórios.' });

    const { data: ag, error: e1 } = await supabaseAdmin
      .from('agendamentos')
      .update({ status })
      .eq('id', id)
      .eq('barbearia_id', loja.id)
      .select('*,clientes(nome,telefone),servicos(*),barbeiros(nome)')
      .single();
    if (e1) throw e1;
    const agView = normalizeAgendamento(ag);

    if (status === 'confirmado') {
      const { data: whats } = await supabaseAdmin.from('barbearia_whatsapp').select('*').eq('barbearia_id', loja.id).eq('ativo', true).maybeSingle();
      if (whats) {
        const texto = msgClienteConfirmado({
          barbearia: loja,
          cliente_nome: agView.cliente_nome,
          servico_nome: agView.servicos?.nome || 'Serviço',
          data_agendamento: agView.data_agendamento,
          hora_inicio: String(agView.hora_inicio).slice(0, 5)
        });
        try {
          const retorno = await sendText({ apiUrl: whats.evolution_api_url, apiKey: whats.evolution_api_key, instanceName: whats.instance_name, number: agView.cliente_whatsapp, text: texto });
          await supabaseAdmin.from('whatsapp_logs').insert(whatsappLogPayload({ barbearia_id: loja.id, agendamento_id: ag.id, destino: agView.cliente_whatsapp, tipo: 'cliente_confirmado', texto, status: 'enviado', retorno }));
        } catch (err) {
          await supabaseAdmin.from('whatsapp_logs').insert(whatsappLogPayload({ barbearia_id: loja.id, agendamento_id: ag.id, destino: agView.cliente_whatsapp, tipo: 'cliente_confirmado', texto, status: 'erro', erro: err.message }));
        }
      }
    }

    return json(res, 200, { sucesso: true, agendamento: agView });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
