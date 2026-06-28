import { json, method, publicBaseUrl } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { sendText, setWebhook } from '../lib/evolution.js';
import { msgClienteLembrete } from '../lib/messages.js';
import { normalizeAgendamento, normalizeBarbearia, whatsappLogPayload } from '../lib/db-compat.js';

const REMINDER_TYPE = 'lembrete_30m';
const REMINDER_MINUTES_MIN = 25;
const REMINDER_MINUTES_MAX = 35;
const RETRYABLE_NOTIFICATION_TYPES = [
  'cliente_confirmado',
  'cliente_cancelado',
  'cliente_resposta_confirmada',
  'cliente_resposta_cancelada',
  'dono_cliente_confirmou',
  'dono_cliente_cancelou'
];

function saoPauloParts(d) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  }).formatToParts(d);

  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function dateOnly(d) {
  const p = saoPauloParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

function hhmm(d) {
  const p = saoPauloParts(d);
  return `${p.hour}:${p.minute}`;
}

function plusMinutes(min, now = new Date()) {
  return new Date(now.getTime() + min * 60 * 1000);
}

function appointmentDate(data, hora) {
  const time = String(hora || '').slice(0, 5);
  return new Date(`${data}T${time}:00-03:00`);
}

function minutesUntilAppointment(ag, now) {
  const agView = normalizeAgendamento(ag);
  const startAt = appointmentDate(agView.data_agendamento, agView.hora_inicio);
  return Math.round((startAt.getTime() - now.getTime()) / 60000);
}

function authSecret(req) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  return String(auth).startsWith('Bearer ') ? String(auth).replace('Bearer ', '').trim() : '';
}

function authorized(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  return req.query.secret === expected || authSecret(req) === expected;
}

async function ensureWebhook(whats) {
  const base = publicBaseUrl();
  if (!base) return { ok: false, erro: 'APP_URL nao configurada.' };
  try {
    const retorno = await setWebhook({
      apiUrl: whats.evolution_api_url,
      apiKey: whats.evolution_api_key,
      instanceName: whats.instance_name,
      webhookUrl: `${base.replace(/\/$/, '')}/api/evolution-webhook`
    });
    return { ok: true, retorno };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}

async function syncActiveWebhooks() {
  const { data, error } = await supabaseAdmin
    .from('barbearia_whatsapp')
    .select('*')
    .eq('ativo', true);
  if (error) throw error;

  let sincronizados = 0;
  let erros = 0;
  for (const whats of data || []) {
    if (!whats.evolution_api_url || !whats.evolution_api_key || !whats.instance_name) continue;
    const result = await ensureWebhook(whats);
    if (result.ok) sincronizados++;
    else erros++;
  }
  return { sincronizados, erros };
}

async function ensureReminderWebhook(whats) {
  try {
    return await ensureWebhook(whats);
  } catch {
    return null;
  }
}

async function sendReminder(ag, whats, tipo) {
  const agView = normalizeAgendamento(ag);
  const loja = normalizeBarbearia(ag.barbearias || {});
  const texto = msgClienteLembrete({
    barbearia: loja,
    cliente_nome: agView.cliente_nome,
    servico_nome: agView.servicos?.nome || 'Serviço',
    data_agendamento: agView.data_agendamento,
    hora_inicio: String(agView.hora_inicio).slice(0, 5)
  });
  try {
    await ensureReminderWebhook(whats);
    const retorno = await sendText({ apiUrl: whats.evolution_api_url, apiKey: whats.evolution_api_key, instanceName: whats.instance_name, number: agView.cliente_whatsapp, text: texto });
    await supabaseAdmin.from('whatsapp_logs').insert(whatsappLogPayload({ barbearia_id: ag.barbearia_id, agendamento_id: ag.id, destino: agView.cliente_whatsapp, tipo, texto, status: 'enviado', retorno }));
    return true;
  } catch (err) {
    await supabaseAdmin.from('whatsapp_logs').insert(whatsappLogPayload({ barbearia_id: ag.barbearia_id, agendamento_id: ag.id, destino: agView.cliente_whatsapp, tipo, texto, status: 'erro', erro: err.message }));
    return false;
  }
}

async function reminderAlreadySent(agendamentoId, tipo) {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_logs')
    .select('id')
    .eq('agendamento_id', agendamentoId)
    .eq('tipo', tipo)
    .eq('status', 'enviado')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function alreadySentAfter(log) {
  let query = supabaseAdmin
    .from('whatsapp_logs')
    .select('id')
    .eq('tipo', log.tipo)
    .eq('numero', log.numero)
    .eq('status', 'enviado')
    .gt('created_at', log.created_at)
    .limit(1);
  query = log.agendamento_id ? query.eq('agendamento_id', log.agendamento_id) : query.is('agendamento_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return !!data;
}

async function retryFailedNotifications() {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('whatsapp_logs')
    .select('id,created_at,barbearia_id,agendamento_id,numero,tipo,mensagem,erro')
    .eq('status', 'erro')
    .in('tipo', RETRYABLE_NOTIFICATION_TYPES)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;

  let encontrados = 0;
  let reenviados = 0;
  let ignorados = 0;
  let erros = 0;
  const processed = new Set();

  for (const log of data || []) {
    const key = `${log.agendamento_id || ''}|${log.numero || ''}|${log.tipo || ''}`;
    if (processed.has(key)) continue;
    processed.add(key);
    encontrados++;

    const logError = String(log.erro || '').toLowerCase();
    const permanentNumberError = logError.includes('exists') && logError.includes('false');

    if (!log.numero || !log.mensagem || permanentNumberError || await alreadySentAfter(log)) {
      ignorados++;
      continue;
    }

    if (log.agendamento_id) {
      const { data: ag, error: agError } = await supabaseAdmin
        .from('agendamentos')
        .select('status')
        .eq('id', log.agendamento_id)
        .maybeSingle();
      if (agError) throw agError;
      const status = String(ag?.status || '');
      if (log.tipo.includes('confirmado') && status === 'cancelado') {
        ignorados++;
        continue;
      }
      if (log.tipo.includes('cancelado') && status !== 'cancelado') {
        ignorados++;
        continue;
      }
    }

    const { data: whats, error: whatsError } = await supabaseAdmin
      .from('barbearia_whatsapp')
      .select('*')
      .eq('barbearia_id', log.barbearia_id)
      .eq('ativo', true)
      .maybeSingle();
    if (whatsError) throw whatsError;
    if (!whats) {
      ignorados++;
      continue;
    }

    try {
      const retorno = await sendText({
        apiUrl: whats.evolution_api_url,
        apiKey: whats.evolution_api_key,
        instanceName: whats.instance_name,
        number: log.numero,
        text: log.mensagem
      });
      await supabaseAdmin.from('whatsapp_logs').insert(whatsappLogPayload({
        barbearia_id: log.barbearia_id,
        agendamento_id: log.agendamento_id,
        destino: log.numero,
        tipo: log.tipo,
        texto: log.mensagem,
        status: 'enviado',
        retorno
      }));
      reenviados++;
    } catch (err) {
      await supabaseAdmin.from('whatsapp_logs').insert(whatsappLogPayload({
        barbearia_id: log.barbearia_id,
        agendamento_id: log.agendamento_id,
        destino: log.numero,
        tipo: log.tipo,
        texto: log.mensagem,
        status: 'erro',
        erro: err.message
      }));
      erros++;
    }
  }

  return { encontrados, reenviados, ignorados, erros };
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    if (!authorized(req)) {
      return json(res, 401, {
        erro: 'Cron nao autorizado.',
        detalhe: 'Use /api/cron-lembretes?secret=O_VALOR_DO_CRON_SECRET ou deixe a Vercel chamar o cron com o header Authorization.'
      });
    }

    const now = new Date();
    const dates = [...new Set([
      dateOnly(plusMinutes(REMINDER_MINUTES_MIN, now)),
      dateOnly(plusMinutes(REMINDER_MINUTES_MAX, now))
    ])];

    let enviados = 0;
    let encontrados = 0;
    let jaEnviados = 0;
    let semWhatsapp = 0;
    let semTelefone = 0;
    let foraDaJanela = 0;
    const webhooks = await syncActiveWebhooks();
    const retentativas = await retryFailedNotifications();

    const { data: ags, error } = await supabaseAdmin
      .from('agendamentos')
      .select('*,clientes(nome,telefone),servicos(*),barbearias(*)')
      .in('data_agendamento', dates)
      .in('status', ['confirmado', 'pendente']);
    if (error) throw error;

    for (const ag of ags || []) {
      const minutesUntil = minutesUntilAppointment(ag, now);
      if (minutesUntil < REMINDER_MINUTES_MIN || minutesUntil > REMINDER_MINUTES_MAX) {
        foraDaJanela++;
        continue;
      }
      encontrados++;

      const agView = normalizeAgendamento(ag);
      if (!agView.cliente_whatsapp) {
        semTelefone++;
        continue;
      }
      if (await reminderAlreadySent(ag.id, REMINDER_TYPE)) {
        jaEnviados++;
        continue;
      }

      const { data: whats } = await supabaseAdmin
        .from('barbearia_whatsapp')
        .select('*')
        .eq('barbearia_id', ag.barbearia_id)
        .eq('ativo', true)
        .maybeSingle();
      if (!whats) {
        semWhatsapp++;
        continue;
      }
      if (await sendReminder(ag, whats, REMINDER_TYPE)) enviados++;
    }

    return json(res, 200, {
      sucesso: true,
      tipo: REMINDER_TYPE,
      janela_minutos: `${REMINDER_MINUTES_MIN}-${REMINDER_MINUTES_MAX}`,
      datas_verificadas: dates,
      encontrados,
      enviados,
      ja_enviados: jaEnviados,
      sem_whatsapp: semWhatsapp,
      sem_telefone: semTelefone,
      fora_da_janela: foraDaJanela,
      webhooks,
      retentativas
    });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
