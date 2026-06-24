import { json, method, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireOwnerBarbearia } from '../lib/auth.js';
import { sendText } from '../lib/evolution.js';
import { msgClienteConfirmado } from '../lib/messages.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'PATCH'])) return;
  try {
    const { barbearia } = await requireOwnerBarbearia(req);

    if (req.method === 'GET') {
      const data = safeString(req.query.data) || new Date().toISOString().slice(0, 10);
      const { data: agendamentos, error } = await supabaseAdmin
        .from('agendamentos')
        .select('*,servicos(nome,preco_cents,duracao_minutos),barbeiros(nome)')
        .eq('barbearia_id', barbearia.id)
        .eq('data_agendamento', data)
        .order('hora_inicio');
      if (error) throw error;
      return json(res, 200, { agendamentos: agendamentos || [] });
    }

    const id = safeString(req.query.id || req.body?.id);
    const status = safeString(req.body?.status);
    if (!id || !status) return json(res, 400, { erro: 'ID e status são obrigatórios.' });

    const { data: ag, error: e1 } = await supabaseAdmin
      .from('agendamentos')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('barbearia_id', barbearia.id)
      .select('*,servicos(nome),barbeiros(nome)')
      .single();
    if (e1) throw e1;

    if (status === 'confirmado') {
      const { data: whats } = await supabaseAdmin.from('barbearia_whatsapp').select('*').eq('barbearia_id', barbearia.id).eq('ativo', true).maybeSingle();
      if (whats) {
        const texto = msgClienteConfirmado({
          barbearia,
          cliente_nome: ag.cliente_nome,
          servico_nome: ag.servicos?.nome || 'Serviço',
          data_agendamento: ag.data_agendamento,
          hora_inicio: String(ag.hora_inicio).slice(0, 5)
        });
        try {
          const retorno = await sendText({ apiUrl: whats.evolution_api_url, apiKey: whats.evolution_api_key, instanceName: whats.instance_name, number: ag.cliente_whatsapp, text: texto });
          await supabaseAdmin.from('whatsapp_logs').insert({ barbearia_id: barbearia.id, agendamento_id: ag.id, destino: ag.cliente_whatsapp, tipo: 'cliente_confirmado', texto, status: 'enviado', retorno });
        } catch (err) {
          await supabaseAdmin.from('whatsapp_logs').insert({ barbearia_id: barbearia.id, agendamento_id: ag.id, destino: ag.cliente_whatsapp, tipo: 'cliente_confirmado', texto, status: 'erro', erro: err.message });
        }
      }
    }

    return json(res, 200, { sucesso: true, agendamento: ag });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
