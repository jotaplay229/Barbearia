import { json, method, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireOwnerBarbearia } from '../lib/auth.js';
import { sendText } from '../lib/evolution.js';
import { msgClienteConfirmado } from '../lib/messages.js';
import { normalizeAgendamento, normalizeBarbearia, whatsappLogPayload } from '../lib/db-compat.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'PATCH'])) return;
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
