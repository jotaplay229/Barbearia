import { json, method, normalizePhoneBR, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { sendText } from '../lib/evolution.js';
import {
  msgClienteCancelamentoConfirmado,
  msgClientePresencaConfirmada,
  msgDonoClienteCancelou,
  msgDonoClienteConfirmou
} from '../lib/messages.js';
import { normalizeAgendamento, normalizeBarbearia, whatsappLogPayload } from '../lib/db-compat.js';

function extractText(body) {
  return safeString(
    body?.data?.message?.conversation ||
    body?.data?.message?.extendedTextMessage?.text ||
    body?.data?.message?.ephemeralMessage?.message?.conversation ||
    body?.data?.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
    body?.data?.message?.buttonsResponseMessage?.selectedButtonId ||
    body?.data?.message?.buttonsResponseMessage?.selectedDisplayText ||
    body?.data?.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    body?.data?.message?.templateButtonReplyMessage?.selectedId ||
    body?.message?.conversation ||
    body?.message?.extendedTextMessage?.text ||
    body?.message?.buttonsResponseMessage?.selectedButtonId ||
    body?.message?.buttonsResponseMessage?.selectedDisplayText ||
    body?.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    body?.message?.templateButtonReplyMessage?.selectedId ||
    body?.text ||
    body?.data?.text
  );
}

function jidToPhone(value) {
  const base = safeString(value).split('@')[0].split(':')[0];
  return normalizePhoneBR(base);
}

function extractRemoteNumber(body) {
  return jidToPhone(
    body?.data?.key?.remoteJid ||
    body?.key?.remoteJid ||
    body?.data?.remoteJid ||
    body?.remoteJid ||
    body?.data?.from ||
    body?.from ||
    body?.sender
  );
}

function extractInstance(body) {
  const raw = body?.instance || body?.data?.instance || body?.instanceName || body?.data?.instanceName;
  if (raw && typeof raw === 'object') {
    return safeString(raw.instanceName || raw.name || raw.instance || raw.id);
  }
  return safeString(raw);
}

function extractEvent(body) {
  return safeString(body?.event || body?.type || body?.data?.event || body?.data?.type || body?.data?.messageType);
}

async function logWhatsapp(payload) {
  await supabaseAdmin.from('whatsapp_logs').insert(whatsappLogPayload(payload));
}

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const body = req.body || {};
    const instance = extractInstance(body);
    const event = extractEvent(body);
    const text = extractText(body).trim().toLowerCase();
    const from = extractRemoteNumber(body);

    await supabaseAdmin.from('webhook_logs').insert({ evento: event || 'messages_upsert', payload: { instance, from, body } });

    if (!instance || !from || !text) return json(res, 200, { recebido: true, ignorado: true });

    const { data: whats, error: e1 } = await supabaseAdmin
      .from('barbearia_whatsapp')
      .select('*,barbearias(*)')
      .eq('instance_name', instance)
      .eq('ativo', true)
      .maybeSingle();
    if (e1) throw e1;
    if (!whats) return json(res, 200, { recebido: true, ignorado: 'instance_not_found' });
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

    const baseMsg = {
      barbearia: loja,
      cliente_nome: agView.cliente_nome,
      servico_nome: agView.servicos?.nome || 'Serviço',
      data_agendamento: agView.data_agendamento,
      hora_inicio: String(agView.hora_inicio).slice(0, 5)
    };
    const respostaCliente = isYes
      ? msgClientePresencaConfirmada(baseMsg)
      : msgClienteCancelamentoConfirmado(baseMsg);

    try {
      const retorno = await sendText({
        apiUrl: whats.evolution_api_url,
        apiKey: whats.evolution_api_key,
        instanceName: whats.instance_name,
        number: from,
        text: respostaCliente
      });
      await logWhatsapp({
        barbearia_id: ag.barbearia_id,
        agendamento_id: ag.id,
        destino: from,
        tipo: isYes ? 'cliente_resposta_confirmada' : 'cliente_resposta_cancelada',
        texto: respostaCliente,
        status: 'enviado',
        retorno
      });
    } catch (err) {
      await logWhatsapp({
        barbearia_id: ag.barbearia_id,
        agendamento_id: ag.id,
        destino: from,
        tipo: isYes ? 'cliente_resposta_confirmada' : 'cliente_resposta_cancelada',
        texto: respostaCliente,
        status: 'erro',
        erro: err.message
      });
    }

    if (loja.whatsapp_dono) {
      const msg = isYes
        ? msgDonoClienteConfirmou(baseMsg)
        : msgDonoClienteCancelou(baseMsg);
      try {
        const retorno = await sendText({
          apiUrl: whats.evolution_api_url,
          apiKey: whats.evolution_api_key,
          instanceName: whats.instance_name,
          number: loja.whatsapp_dono,
          text: msg
        });
        await logWhatsapp({
          barbearia_id: ag.barbearia_id,
          agendamento_id: ag.id,
          destino: loja.whatsapp_dono,
          tipo: isYes ? 'dono_cliente_confirmou' : 'dono_cliente_cancelou',
          texto: msg,
          status: 'enviado',
          retorno
        });
      } catch (err) {
        await logWhatsapp({
          barbearia_id: ag.barbearia_id,
          agendamento_id: ag.id,
          destino: loja.whatsapp_dono,
          tipo: isYes ? 'dono_cliente_confirmou' : 'dono_cliente_cancelou',
          texto: msg,
          status: 'erro',
          erro: err.message
        });
      }
    }

    return json(res, 200, { recebido: true, agendamento: normalizeAgendamento(atualizado) });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
