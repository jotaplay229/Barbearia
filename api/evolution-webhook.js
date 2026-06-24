import { json, method, normalizePhoneBR, safeString } from './_lib/http.js';
import { supabaseAdmin } from './_lib/supabase.js';
import { sendText } from './_lib/evolution.js';
import { msgDonoClienteConfirmou, msgDonoClienteCancelou } from './_lib/messages.js';

function extractText(body) {
  return safeString(
    body?.data?.message?.conversation ||
    body?.data?.message?.extendedTextMessage?.text ||
    body?.message?.conversation ||
    body?.text ||
    body?.data?.text
  );
}
function extractRemoteNumber(body) {
  const jid = safeString(body?.data?.key?.remoteJid || body?.key?.remoteJid || body?.remoteJid || body?.from);
  return normalizePhoneBR(jid.split('@')[0]);
}
function extractInstance(body) {
  return safeString(body?.instance || body?.data?.instance || body?.instanceName || body?.data?.instanceName);
}

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const body = req.body || {};
    const instance = extractInstance(body);
    const text = extractText(body).trim().toLowerCase();
    const from = extractRemoteNumber(body);

    await supabaseAdmin.from('webhook_logs').insert({ instance_name: instance, telefone: from, payload: body });

    if (!instance || !from || !text) return json(res, 200, { recebido: true, ignorado: true });

    const { data: whats, error: e1 } = await supabaseAdmin
      .from('barbearia_whatsapp')
      .select('*,barbearias(*)')
      .eq('instance_name', instance)
      .eq('ativo', true)
      .maybeSingle();
    if (e1) throw e1;
    if (!whats) return json(res, 200, { recebido: true, ignorado: 'instance_not_found' });

    const { data: ag, error: e2 } = await supabaseAdmin
      .from('agendamentos')
      .select('*,servicos(nome)')
      .eq('barbearia_id', whats.barbearia_id)
      .eq('cliente_whatsapp', from)
      .in('status', ['aguardando_confirmacao_cliente', 'confirmado', 'pendente'])
      .gte('data_agendamento', new Date().toISOString().slice(0, 10))
      .order('data_agendamento', { ascending: true })
      .order('hora_inicio', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (e2) throw e2;
    if (!ag) return json(res, 200, { recebido: true, ignorado: 'appointment_not_found' });

    const isYes = ['1', 'sim', 's', 'vou', 'confirmo', 'confirmar'].includes(text);
    const isNo = ['2', 'nao', 'não', 'n', 'cancelar', 'cancela'].includes(text);

    if (!isYes && !isNo) return json(res, 200, { recebido: true, ignorado: 'text_not_command' });

    const status = isYes ? 'cliente_confirmou' : 'cancelado_cliente';
    const { data: atualizado, error: e3 } = await supabaseAdmin
      .from('agendamentos')
      .update({ status, resposta_cliente: text, updated_at: new Date().toISOString() })
      .eq('id', ag.id)
      .select('*')
      .single();
    if (e3) throw e3;

    if (whats.barbearias?.whatsapp_dono) {
      const msg = isYes
        ? msgDonoClienteConfirmou({ cliente_nome: ag.cliente_nome, servico_nome: ag.servicos?.nome || 'Serviço', data_agendamento: ag.data_agendamento, hora_inicio: String(ag.hora_inicio).slice(0, 5) })
        : msgDonoClienteCancelou({ cliente_nome: ag.cliente_nome, servico_nome: ag.servicos?.nome || 'Serviço', data_agendamento: ag.data_agendamento, hora_inicio: String(ag.hora_inicio).slice(0, 5) });
      try {
        const retorno = await sendText({ apiUrl: whats.evolution_api_url, apiKey: whats.evolution_api_key, instanceName: whats.instance_name, number: whats.barbearias.whatsapp_dono, text: msg });
        await supabaseAdmin.from('whatsapp_logs').insert({ barbearia_id: ag.barbearia_id, agendamento_id: ag.id, destino: whats.barbearias.whatsapp_dono, tipo: isYes ? 'dono_cliente_confirmou' : 'dono_cliente_cancelou', texto: msg, status: 'enviado', retorno });
      } catch (err) {
        await supabaseAdmin.from('whatsapp_logs').insert({ barbearia_id: ag.barbearia_id, agendamento_id: ag.id, destino: whats.barbearias.whatsapp_dono, tipo: isYes ? 'dono_cliente_confirmou' : 'dono_cliente_cancelou', texto: msg, status: 'erro', erro: err.message });
      }
    }

    return json(res, 200, { recebido: true, agendamento: atualizado });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
