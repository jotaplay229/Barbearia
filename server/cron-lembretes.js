import { json, method, publicBaseUrl } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { sendText, setWebhook } from '../lib/evolution.js';
import { msgClienteLembrete } from '../lib/messages.js';
import { normalizeAgendamento, normalizeBarbearia, whatsappLogPayload } from '../lib/db-compat.js';

const REMINDER_TYPE = 'lembrete_30m';
const REMINDER_MINUTES_MIN = 25;
const REMINDER_MINUTES_MAX = 35;

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
  if (!base) return null;
  try {
    return await setWebhook({
      apiUrl: whats.evolution_api_url,
      apiKey: whats.evolution_api_key,
      instanceName: whats.instance_name,
      webhookUrl: `${base.replace(/\/$/, '')}/api/evolution-webhook`
    });
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
    await ensureWebhook(whats);
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
      fora_da_janela: foraDaJanela
    });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
