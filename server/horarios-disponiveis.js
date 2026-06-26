import { json, method, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { normalizeBarbearia, normalizeServico, serviceForBarber } from '../lib/db-compat.js';

function toMinutes(t) {
  const [h, m] = String(t || '00:00').split(':').map(Number);
  return h * 60 + m;
}
function toTime(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}
function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
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
      .select('*')
      .eq('slug', slug)
      .eq('status', 'ativa')
      .maybeSingle();
    if (e1) throw e1;
    if (!barbearia) return json(res, 404, { erro: 'Barbearia não encontrada.' });
    const loja = normalizeBarbearia(barbearia);

    const dow = dayOfWeek(dataAg);
    const { data: horario, error: e2 } = await supabaseAdmin
      .from('horarios_funcionamento')
      .select('*')
      .eq('barbearia_id', loja.id)
      .eq('dia_semana', dow)
      .maybeSingle();
    if (e2) throw e2;
    if (!horario || !horario.ativo) return json(res, 200, { horarios: [] });

    const { data: servico } = await supabaseAdmin
      .from('servicos')
      .select('*')
      .eq('id', servicoId)
      .eq('barbearia_id', loja.id)
      .eq('ativo', true)
      .maybeSingle();
    const servicoNorm = serviceForBarber(servico || {}, barbeiroId);
    if (servicoNorm.disponivel_para_barbeiro === false) return json(res, 200, { horarios: [] });
    const duracao = Number(servicoNorm.duracao_minutos || loja.intervalo_minutos || 30);
    const intervalo = Number(loja.intervalo_minutos || 30);

    let query = supabaseAdmin
      .from('agendamentos')
      .select('hora_inicio,hora_fim,barbeiro_id,status,servicos(*)')
      .eq('barbearia_id', loja.id)
      .eq('data_agendamento', dataAg)
      .not('status', 'in', '(cancelado,recusado,cancelado_cliente)');
    if (barbeiroId) query = query.eq('barbeiro_id', barbeiroId);
    const { data: ocupados, error: e3 } = await query;
    if (e3) throw e3;

    const busy = (ocupados || []).map(a => {
      const start = toMinutes(String(a.hora_inicio).slice(0, 5));
      const end = a.hora_fim ? toMinutes(String(a.hora_fim).slice(0, 5)) : start + Number(normalizeServico(a.servicos || {}).duracao_minutos || intervalo);
      return { start, end };
    });
    const open = toMinutes(horario.abre);
    const close = toMinutes(horario.fecha);
    const horarios = [];
    for (let m = open; m + duracao <= close; m += intervalo) {
      const t = toTime(m);
      if (!busy.some(slot => overlaps(m, m + duracao, slot.start, slot.end))) horarios.push(t);
    }
    return json(res, 200, { horarios });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
