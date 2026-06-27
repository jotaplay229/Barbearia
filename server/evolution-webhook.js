import { json, method, normalizePhoneBR, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { sendText, setInstanceSettings } from '../lib/evolution.js';
import { msgDonoClienteConfirmou, msgDonoClienteCancelou } from '../lib/messages.js';
import { normalizeAgendamento, normalizeBarbearia, whatsappLogPayload } from '../lib/db-compat.js';

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
function extractCallNumber(body) {
  const jid = safeString(
    body?.data?.call?.from ||
    body?.call?.from ||
    body?.data?.from ||
    body?.data?.key?.remoteJid ||
    body?.key?.remoteJid ||
    body?.remoteJid ||
    body?.from ||
    body?.caller
  );
  return normalizePhoneBR(jid.split('@')[0]);
}
function extractInstance(body) {
  return safeString(body?.instance || body?.data?.instance || body?.instanceName || body?.data?.instanceName);
}
function extractEvent(body) {
  return safeString(body?.event || body?.type || body?.data?.event || body?.data?.type || body?.data?.messageType);
}
function isCallEvent(body, event) {
  const normalized = safeString(event).toUpperCase();
  return normalized.includes('CALL') || !!(body?.data?.call || body?.call || body?.data?.callId || body?.callId);
}

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const body = req.body || {};
    const instance = extractInstance(body);
    const event = extractEvent(body);
    const callEvent = isCallEvent(body, event);
    const text = extractText(body).trim().toLowerCase();
    const from = callEvent ? extractCallNumber(body) : extractRemoteNumber(body);

    await supabaseAdmin.from('webhook_logs').insert({ evento: event || (callEvent ? 'call' : 'messages_upsert'), payload: { instance, from, body } });

    if (!instance || !from) return json(res, 200, { recebido: true, ignorado: true });

    const { data: whats, error: e1 } = await supabaseAdmin
      .from('barbearia_whatsapp')
      .select('*,barbearias(*)')
      .eq('instance_name', instance)
      .eq('ativo', true)
      .maybeSingle();
    if (e1) throw e1;
    if (!whats) return json(res, 200, { recebido: true, ignorado: 'instance_not_found' });

    if (callEvent) {
      let settings = null;
      try {
        settings = await setInstanceSettings({
          apiUrl: whats.evolution_api_url,
          apiKey: whats.evolution_api_key,
          instanceName: whats.instance_name
        });
      } catch (err) {
        settings = { erro: err.message };
      }
      await supabaseAdmin.from('whatsapp_logs').insert(whatsappLogPayload({
        barbearia_id: whats.barbearia_id,
        destino: from,
        tipo: 'ligacao_recusada',
        texto: 'Ligacao recusada automaticamente pela Evolution.',
        status: settings?.erro ? 'erro' : 'registrado',
        retorno: settings,
        erro: settings?.erro
      }));
      return json(res, 200, { recebido: true, ligacao: true, settings });
    }

    if (!text) return json(res, 200, { recebido: true, ignorado: true });
    const loja = normalizeBarbearia(whats.barbearias || {});

    const { data: ag, error: e2 } = await supabaseAdmin
      .from('agendamentos')
      .select('*,clientes!inner(nome,telefone),servicos(*)')
      .eq('barbearia_id', whats.barbearia_id)
      .eq('clientes.telefone', from)
      .in('status', ['aguardando_confirmacao_cliente', 'confirmado', 'pendente'])
      .gte('data_agendamento', new Date().toISOString().slice(0, 10))
      .order('data_agendamento', { ascending: true })
      .order('hora_inicio', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (e2) throw e2;
    if (!ag) return json(res, 200, { recebido: true, ignorado: 'appointment_not_found' });
    const agView = normalizeAgendamento(ag);

    const isYes = ['1', 'sim', 's', 'vou', 'confirmo', 'confirmar'].includes(text);
    const isNo = ['2', 'nao', 'não', 'n', 'cancelar', 'cancela'].includes(text);

    if (!isYes && !isNo) return json(res, 200, { recebido: true, ignorado: 'text_not_command' });

    const status = isYes ? 'cliente_confirmou' : 'cancelado_cliente';
    const { data: atualizado, error: e3 } = await supabaseAdmin
      .from('agendamentos')
      .update({ status })
      .eq('id', ag.id)
      .select('*,clientes(nome,telefone),servicos(*)')
      .single();
    if (e3) throw e3;

    if (loja.whatsapp_dono) {
      const msg = isYes
        ? msgDonoClienteConfirmou({ cliente_nome: agView.cliente_nome, servico_nome: agView.servicos?.nome || 'Serviço', data_agendamento: agView.data_agendamento, hora_inicio: String(agView.hora_inicio).slice(0, 5) })
        : msgDonoClienteCancelou({ cliente_nome: agView.cliente_nome, servico_nome: agView.servicos?.nome || 'Serviço', data_agendamento: agView.data_agendamento, hora_inicio: String(agView.hora_inicio).slice(0, 5) });
      try {
        const retorno = await sendText({ apiUrl: whats.evolution_api_url, apiKey: whats.evolution_api_key, instanceName: whats.instance_name, number: loja.whatsapp_dono, text: msg });
        await supabaseAdmin.from('whatsapp_logs').insert(whatsappLogPayload({ barbearia_id: ag.barbearia_id, agendamento_id: ag.id, destino: loja.whatsapp_dono, tipo: isYes ? 'dono_cliente_confirmou' : 'dono_cliente_cancelou', texto: msg, status: 'enviado', retorno }));
      } catch (err) {
        await supabaseAdmin.from('whatsapp_logs').insert(whatsappLogPayload({ barbearia_id: ag.barbearia_id, agendamento_id: ag.id, destino: loja.whatsapp_dono, tipo: isYes ? 'dono_cliente_confirmou' : 'dono_cliente_cancelou', texto: msg, status: 'erro', erro: err.message }));
      }
    }

    return json(res, 200, { recebido: true, agendamento: normalizeAgendamento(atualizado) });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
