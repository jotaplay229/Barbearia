import { json, method, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { normalizeBarbearia, normalizeServico, serviceForBarber } from '../lib/db-compat.js';

const TIME_ZONE = 'America/Sao_Paulo';

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
function minVisibleStartForDate(dateStr) {
  const today = todaySaoPaulo();
  if (dateStr < today) return Infinity;
  if (dateStr === today) return currentMinutesSaoPaulo();
  return -1;
}
function cleanSlots(slots) {
  return Array.isArray(slots)
    ? [...new Set(slots.map(t => safeString(t).slice(0, 5)).filter(t => /^\d{2}:\d{2}$/.test(t)))].sort()
    : [];
}
function customSlotsForDay(loja, dow, barbeiroId) {
  const custom = loja.horarios_custom || {};
  const barberDays = barbeiroId && custom.por_barbeiro ? custom.por_barbeiro[barbeiroId] : null;
  const globalSlots = cleanSlots(custom.global?.[dow] || custom.global?.[String(dow)] || custom[dow] || custom[String(dow)] || []);
  const barberSlots = cleanSlots(barberDays?.[dow] || barberDays?.[String(dow)] || []);
  return [...new Set([...globalSlots, ...barberSlots])].sort();
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
    const minStart = minVisibleStartForDate(dataAg);
    const customSlots = customSlotsForDay(loja, dow, barbeiroId);
    if (customSlots.length) {
      for (const t of customSlots) {
        const m = toMinutes(t);
        if (m > minStart && !busy.some(slot => overlaps(m, m + duracao, slot.start, slot.end))) horarios.push(t);
      }
    } else {
      for (let m = open; m + duracao <= close; m += intervalo) {
        const t = toTime(m);
        if (m > minStart && !busy.some(slot => overlaps(m, m + duracao, slot.start, slot.end))) horarios.push(t);
      }
    }
    return json(res, 200, { horarios });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
