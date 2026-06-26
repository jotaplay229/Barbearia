import { json, method } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { sendText } from '../lib/evolution.js';
import { msgClienteLembrete } from '../lib/messages.js';
import { normalizeAgendamento, normalizeBarbearia, whatsappLogPayload } from '../lib/db-compat.js';

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

function plusHours(h) {
  return new Date(Date.now() + h * 60 * 60 * 1000);
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
    const retorno = await sendText({ apiUrl: whats.evolution_api_url, apiKey: whats.evolution_api_key, instanceName: whats.instance_name, number: agView.cliente_whatsapp, text: texto });
    await supabaseAdmin.from('whatsapp_logs').insert(whatsappLogPayload({ barbearia_id: ag.barbearia_id, agendamento_id: ag.id, destino: agView.cliente_whatsapp, tipo, texto, status: 'enviado', retorno }));
    if (tipo === 'lembrete_2h' && ag.status === 'confirmado') {
      await supabaseAdmin.from('agendamentos').update({ status: 'aguardando_confirmacao_cliente' }).eq('id', ag.id);
    }
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
    if (process.env.CRON_SECRET && req.query.secret !== process.env.CRON_SECRET) {
      return json(res, 401, {
        erro: 'Cron nao autorizado.',
        detalhe: 'Adicione ?secret=SUA_CHAVE no final da URL do cron.'
      });
    }

    const target24 = plusHours(24);
    const target2 = plusHours(2);
    const windows = [
      { tipo: 'lembrete_24h', data: dateOnly(target24), hora: hhmm(target24) },
      { tipo: 'lembrete_2h', data: dateOnly(target2), hora: hhmm(target2) }
    ];

    let enviados = 0;
    let encontrados = 0;

    for (const w of windows) {
      const { data: ags, error } = await supabaseAdmin
        .from('agendamentos')
        .select('*,clientes(nome,telefone),servicos(*),barbearias(*)')
        .eq('data_agendamento', w.data)
        .gte('hora_inicio', w.hora)
        .lte('hora_inicio', w.hora.slice(0, 3) + '59')
        .in('status', ['confirmado', 'pendente']);
      if (error) throw error;

      for (const ag of ags || []) {
        encontrados++;
        if (await reminderAlreadySent(ag.id, w.tipo)) continue;
        const { data: whats } = await supabaseAdmin.from('barbearia_whatsapp').select('*').eq('barbearia_id', ag.barbearia_id).eq('ativo', true).maybeSingle();
        if (!whats) continue;
        if (await sendReminder(ag, whats, w.tipo)) enviados++;
      }
    }

    return json(res, 200, { sucesso: true, encontrados, enviados });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
