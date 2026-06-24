import { json, method } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { sendText } from '../lib/evolution.js';
import { msgClienteLembrete } from '../lib/messages.js';

function nowInSaoPaulo() {
  // MVP: usa UTC do servidor e compara por data/hora local salva no banco.
  return new Date();
}
function dateOnly(d) { return d.toISOString().slice(0, 10); }
function hhmm(d) { return d.toISOString().slice(11, 16); }
function plusHours(h) { const d = nowInSaoPaulo(); d.setHours(d.getHours() + h); return d; }

async function sendReminder(ag, whats, tipo) {
  const texto = msgClienteLembrete({
    barbearia: ag.barbearias,
    cliente_nome: ag.cliente_nome,
    servico_nome: ag.servicos?.nome || 'Serviço',
    data_agendamento: ag.data_agendamento,
    hora_inicio: String(ag.hora_inicio).slice(0, 5)
  });
  try {
    const retorno = await sendText({ apiUrl: whats.evolution_api_url, apiKey: whats.evolution_api_key, instanceName: whats.instance_name, number: ag.cliente_whatsapp, text: texto });
    await supabaseAdmin.from('whatsapp_logs').insert({ barbearia_id: ag.barbearia_id, agendamento_id: ag.id, destino: ag.cliente_whatsapp, tipo, texto, status: 'enviado', retorno });
    const patch = tipo === 'lembrete_24h' ? { lembrete_24h_enviado: true } : { lembrete_2h_enviado: true, status: ag.status === 'confirmado' ? 'aguardando_confirmacao_cliente' : ag.status };
    await supabaseAdmin.from('agendamentos').update(patch).eq('id', ag.id);
    return true;
  } catch (err) {
    await supabaseAdmin.from('whatsapp_logs').insert({ barbearia_id: ag.barbearia_id, agendamento_id: ag.id, destino: ag.cliente_whatsapp, tipo, texto, status: 'erro', erro: err.message });
    return false;
  }
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    if (process.env.CRON_SECRET && req.query.secret !== process.env.CRON_SECRET) {
      return json(res, 401, { erro: 'Cron não autorizado.' });
    }

    const target24 = plusHours(24);
    const target2 = plusHours(2);
    const windows = [
      { tipo: 'lembrete_24h', data: dateOnly(target24), hora: hhmm(target24), flag: 'lembrete_24h_enviado' },
      { tipo: 'lembrete_2h', data: dateOnly(target2), hora: hhmm(target2), flag: 'lembrete_2h_enviado' }
    ];

    let enviados = 0;
    let encontrados = 0;

    for (const w of windows) {
      const { data: ags, error } = await supabaseAdmin
        .from('agendamentos')
        .select('*,servicos(nome),barbearias(id,nome,whatsapp_dono)')
        .eq('data_agendamento', w.data)
        .gte('hora_inicio', w.hora)
        .lte('hora_inicio', w.hora.slice(0, 3) + '59')
        .eq(w.flag, false)
        .in('status', ['confirmado', 'pendente']);
      if (error) throw error;

      for (const ag of ags || []) {
        encontrados++;
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
