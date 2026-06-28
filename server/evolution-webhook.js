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

const TIME_ZONE = 'America/Sao_Paulo';

function eventData(body) {
  return Array.isArray(body?.data) ? body.data[0] || {} : body?.data || {};
}

function findDeepValue(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const [key, value] of Object.entries(obj)) {
    const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');
    if (keys.has(normalizedKey) && typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      const found = findDeepValue(value, keys);
      if (found) return found;
    }
  }
  return '';
}

function extractText(body) {
  const data = eventData(body);
  return safeString(
    data?.message?.conversation ||
    data?.message?.extendedTextMessage?.text ||
    data?.message?.ephemeralMessage?.message?.conversation ||
    data?.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
    data?.message?.buttonsResponseMessage?.selectedButtonId ||
    data?.message?.buttonsResponseMessage?.selectedDisplayText ||
    data?.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    data?.message?.templateButtonReplyMessage?.selectedId ||
    body?.message?.conversation ||
    body?.message?.extendedTextMessage?.text ||
    body?.message?.buttonsResponseMessage?.selectedButtonId ||
    body?.message?.buttonsResponseMessage?.selectedDisplayText ||
    body?.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    body?.message?.templateButtonReplyMessage?.selectedId ||
    body?.text ||
    data?.text ||
    findDeepValue(body, new Set(['conversation', 'text', 'selectedbuttonid', 'selecteddisplaytext', 'selectedrowid', 'selectedid']))
  );
}

function jidToPhone(value) {
  const base = safeString(value).split('@')[0].split(':')[0];
  return normalizePhoneBR(base);
}

function extractRemoteNumber(body) {
  const data = eventData(body);
  return jidToPhone(
    data?.key?.remoteJid ||
    body?.key?.remoteJid ||
    data?.remoteJid ||
    body?.remoteJid ||
    data?.from ||
    data?.sender ||
    body?.sender ||
    body?.from ||
    data?.key?.participant ||
    body?.key?.participant ||
    findDeepValue(body, new Set(['remotejid', 'sender', 'participant']))
  );
}

function extractInstance(body) {
  const data = eventData(body);
  const raw = body?.instance || data?.instance || body?.instanceName || data?.instanceName || findDeepValue(body, new Set(['instancename']));
  if (raw && typeof raw === 'object') {
    return safeString(raw.instanceName || raw.name || raw.instance || raw.id);
  }
  return safeString(raw);
}

function extractEvent(body) {
  const data = eventData(body);
  return safeString(body?.event || body?.type || data?.event || data?.type || data?.messageType);
}

function isFromMe(body) {
  const data = eventData(body);
  return Boolean(data?.key?.fromMe || body?.key?.fromMe || data?.fromMe || body?.fromMe);
}

function toMinutes(time) {
  const [h, m] = String(time || '00:00').slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

function saoPauloNowParts() {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(new Date())
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
}

function todaySaoPaulo() {
  const parts = saoPauloNowParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function currentMinutesSaoPaulo() {
  const parts = saoPauloNowParts();
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function isUpcomingAppointment(row) {
  const date = String(row?.data_agendamento || '').slice(0, 10);
  const today = todaySaoPaulo();
  if (date > today) return true;
  if (date < today) return false;
  return toMinutes(row?.hora_inicio) >= currentMinutesSaoPaulo();
}

function phoneCandidates(number) {
  const normalized = normalizePhoneBR(number);
  const local = normalized.startsWith('55') ? normalized.slice(2) : normalized;
  const candidates = [normalized, local];
  if (local.length === 11 && local[2] === '9') {
    const withoutNinth = local.slice(0, 2) + local.slice(3);
    candidates.push(withoutNinth, `55${withoutNinth}`);
  }
  if (local.length === 10) {
    const withNinth = `${local.slice(0, 2)}9${local.slice(2)}`;
    candidates.push(withNinth, `55${withNinth}`);
  }
  return [...new Set(candidates.filter(Boolean))];
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
    if (isFromMe(body)) return json(res, 200, { recebido: true, ignorado: 'outgoing_message' });

    const { data: whats, error: e1 } = await supabaseAdmin
      .from('barbearia_whatsapp')
      .select('*,barbearias(*)')
      .eq('instance_name', instance)
      .eq('ativo', true)
      .maybeSingle();
    if (e1) throw e1;
    if (!whats) return json(res, 200, { recebido: true, ignorado: 'instance_not_found' });
    const loja = normalizeBarbearia(whats.barbearias || {});

    const { data: ags, error: e2 } = await supabaseAdmin
      .from('agendamentos')
      .select('*,clientes!inner(nome,telefone),servicos(*)')
      .eq('barbearia_id', whats.barbearia_id)
      .in('clientes.telefone', phoneCandidates(from))
      .in('status', ['aguardando_confirmacao_cliente', 'confirmado', 'pendente'])
      .gte('data_agendamento', todaySaoPaulo())
      .order('data_agendamento', { ascending: true })
      .order('hora_inicio', { ascending: true })
      .limit(10);
    if (e2) throw e2;
    const ag = (ags || []).find(isUpcomingAppointment);
    if (!ag) return json(res, 200, { recebido: true, ignorado: 'appointment_not_found' });

    const agView = normalizeAgendamento(ag);
    const isYes = ['1', 'sim', 's', 'vou', 'confirmo', 'confirmar'].includes(text);
    const isNo = ['2', 'nao', 'não', 'n', 'cancelar', 'cancela'].includes(text);

    if (!isYes && !isNo) return json(res, 200, { recebido: true, ignorado: 'text_not_command' });

    const status = isYes ? 'confirmado' : 'cancelado';
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
