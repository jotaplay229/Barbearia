import { json, method, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { normalizeAgendamento } from '../lib/db-compat.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const id = safeString(req.query.id);
    if (!id) return json(res, 400, { erro: 'ID obrigatório.' });
    const { data, error } = await supabaseAdmin
      .from('agendamentos')
      .select('id,status,data_agendamento,hora_inicio,clientes(nome),barbearias(nome)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return json(res, 404, { erro: 'Agendamento não encontrado.' });
    const ag = normalizeAgendamento(data);
    return res.status(200).send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial;background:#090909;color:#fff;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px"><div><h2>Agendamento encontrado ✅</h2><p>${ag.cliente_nome || 'Cliente'}, seu horário na ${data.barbearias?.nome || 'barbearia'} está como <b>${data.status}</b>.</p><p>${data.data_agendamento} às ${String(data.hora_inicio).slice(0,5)}</p><small>Para confirmar presença pelo WhatsApp, responda 1 na mensagem de lembrete.</small></div></body>`);
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
