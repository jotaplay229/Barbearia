import { json, method, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';

function toMinutes(t) {
  const [h, m] = String(t || '00:00').split(':').map(Number);
  return h * 60 + m;
}
function toTime(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}
function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const slug = safeString(req.query.slug);
    const dataAg = safeString(req.query.data);
    const servicoId = safeString(req.query.servico_id);
    const barbeiroId = safeString(req.query.barbeiro_id);
    if (!slug || !dataAg || !servicoId) return json(res, 400, { erro: 'slug, data e servico_id são obrigatórios.' });

    const { data: barbearia, error: e1 } = await supabaseAdmin
      .from('barbearias')
      .select('id,intervalo_minutos,status')
      .eq('slug', slug)
      .eq('status', 'ativa')
      .maybeSingle();
    if (e1) throw e1;
    if (!barbearia) return json(res, 404, { erro: 'Barbearia não encontrada.' });

    const dow = dayOfWeek(dataAg);
    const { data: horario, error: e2 } = await supabaseAdmin
      .from('horarios_funcionamento')
      .select('*')
      .eq('barbearia_id', barbearia.id)
      .eq('dia_semana', dow)
      .maybeSingle();
    if (e2) throw e2;
    if (!horario || !horario.ativo) return json(res, 200, { horarios: [] });

    const { data: servico } = await supabaseAdmin
      .from('servicos')
      .select('duracao_minutos')
      .eq('id', servicoId)
      .eq('barbearia_id', barbearia.id)
      .eq('ativo', true)
      .maybeSingle();
    const duracao = Number(servico?.duracao_minutos || barbearia.intervalo_minutos || 30);
    const intervalo = Number(barbearia.intervalo_minutos || 30);

    let query = supabaseAdmin
      .from('agendamentos')
      .select('hora_inicio,barbeiro_id,status')
      .eq('barbearia_id', barbearia.id)
      .eq('data_agendamento', dataAg)
      .not('status', 'in', '(cancelado,recusado)');
    if (barbeiroId) query = query.eq('barbeiro_id', barbeiroId);
    const { data: ocupados, error: e3 } = await query;
    if (e3) throw e3;

    const busy = new Set((ocupados || []).map(a => String(a.hora_inicio).slice(0, 5)));
    const open = toMinutes(horario.abre);
    const close = toMinutes(horario.fecha);
    const horarios = [];
    for (let m = open; m + duracao <= close; m += intervalo) {
      const t = toTime(m);
      if (!busy.has(t)) horarios.push(t);
    }
    return json(res, 200, { horarios });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
