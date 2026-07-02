import { isValidMobilePhoneBR, json, method, normalizePhoneBR, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { sendText } from '../lib/evolution.js';
import { msgClienteConfirmado } from '../lib/messages.js';
import { normalizeAgendamento, normalizeBarbearia, normalizeServico, serviceForBarber, whatsappLogPayload } from '../lib/db-compat.js';

const TIME_ZONE = 'America/Sao_Paulo';
const CANCELLED_STATUSES = ['cancelado', 'recusado', 'cancelado_cliente'];

function toMinutes(t) {
  const [h, m] = String(t || '00:00').split(':').map(Number);
  return h * 60 + m;
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function toTime(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function isValidTime(t) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(t || '').slice(0, 5));
  if (!match) return false;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h >= 0 && h < 24 && m >= 0 && m < 60;
}

function dayOfWeek(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
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
function isPastAppointment(dateStr, startMinutes) {
  const today = todaySaoPaulo();
  return dateStr < today || (dateStr === today && startMinutes <= currentMinutesSaoPaulo());
}
function cleanSlots(slots) {
  return Array.isArray(slots)
    ? [...new Set(slots.map(t => safeString(t).slice(0, 5)).filter(isValidTime))].sort()
    : [];
}
function customSlotsForDay(loja, dow, barbeiroId) {
  const custom = loja.horarios_custom || {};
  const barberDays = barbeiroId && custom.por_barbeiro ? custom.por_barbeiro[barbeiroId] : null;
  const globalSlots = cleanSlots(custom.global?.[dow] || custom.global?.[String(dow)] || custom[dow] || custom[String(dow)] || []);
  const barberSlots = cleanSlots(barberDays?.[dow] || barberDays?.[String(dow)] || []);
  return [...new Set([...globalSlots, ...barberSlots])].sort();
}

async function getWhatsapp(barbeariaId) {
  const { data, error } = await supabaseAdmin
    .from('barbearia_whatsapp')
    .select('*')
    .eq('barbearia_id', barbeariaId)
    .eq('ativo', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function logWhatsapp({ barbearia_id, agendamento_id, destino, tipo, texto, status, erro, retorno }) {
  await supabaseAdmin.from('whatsapp_logs').insert(whatsappLogPayload({
    barbearia_id,
    agendamento_id,
    destino,
    tipo,
    texto,
    status,
    erro: erro || null,
    retorno: retorno || null
  }));
}

function isInvalidWhatsappNumberError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('exists') && msg.includes('false');
}

function isDuplicateSlotError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === '23505' || msg.includes('duplicate key') || msg.includes('agendamentos_barbearia_id_barbeiro_id_data_agendamento_hora');
}

async function findCancelledSlot({ barbeariaId, barbeiroId, data, hora }) {
  let query = supabaseAdmin
    .from('agendamentos')
    .select('id,status')
    .eq('barbearia_id', barbeariaId)
    .eq('data_agendamento', data)
    .eq('hora_inicio', hora)
    .in('status', CANCELLED_STATUSES)
    .limit(1);
  query = barbeiroId ? query.eq('barbeiro_id', barbeiroId) : query.is('barbeiro_id', null);
  const { data: rows, error } = await query;
  if (error) throw error;
  return rows?.[0] || null;
}

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const body = req.body || {};
    const slug = safeString(body.slug);
    const cliente_nome = safeString(body.cliente_nome);
    const cliente_whatsapp = normalizePhoneBR(body.cliente_whatsapp);
    const servico_id = safeString(body.servico_id);
    const barbeiro_id = safeString(body.barbeiro_id) || null;
    const data_agendamento = safeString(body.data_agendamento);
    const hora_inicio = safeString(body.hora_inicio);
    const observacoes = safeString(body.observacoes);

    if (!slug || !cliente_nome || !cliente_whatsapp || !servico_id || !data_agendamento || !hora_inicio) {
      return json(res, 400, { erro: 'Dados obrigatórios faltando.' });
    }
    if (!isValidMobilePhoneBR(cliente_whatsapp)) {
      return json(res, 400, { erro: 'Digite um WhatsApp valido com DDD e 9 digitos.' });
    }
    if (!isValidTime(hora_inicio)) {
      return json(res, 400, { erro: 'Informe um horario valido.' });
    }

    const { data: barbearia, error: e1 } = await supabaseAdmin
      .from('barbearias')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'ativa')
      .maybeSingle();
    if (e1) throw e1;
    if (!barbearia) return json(res, 404, { erro: 'Barbearia não encontrada ou indisponível.' });
    const loja = normalizeBarbearia(barbearia);

    const { data: servico, error: e2 } = await supabaseAdmin
      .from('servicos')
      .select('*')
      .eq('id', servico_id)
      .eq('barbearia_id', loja.id)
      .eq('ativo', true)
      .maybeSingle();
    if (e2) throw e2;
    if (!servico) return json(res, 404, { erro: 'Serviço indisponível.' });
    const servicoNorm = serviceForBarber(servico, barbeiro_id);
    if (servicoNorm.disponivel_para_barbeiro === false) {
      return json(res, 400, { erro: 'Esse serviço não está disponível para o profissional escolhido.' });
    }

    let barbeiro = null;
    if (barbeiro_id) {
      const r = await supabaseAdmin
        .from('barbeiros')
        .select('id,nome')
        .eq('id', barbeiro_id)
        .eq('barbearia_id', loja.id)
        .eq('ativo', true)
        .maybeSingle();
      if (r.error) throw r.error;
      barbeiro = r.data;
      if (!barbeiro) return json(res, 404, { erro: 'Barbeiro indisponível.' });
    }

    let conflitosQuery = supabaseAdmin
      .from('agendamentos')
      .select('id,hora_inicio,hora_fim,servicos(*)')
      .eq('barbearia_id', loja.id)
      .eq('data_agendamento', data_agendamento)
      .not('status', 'in', '(cancelado,recusado,cancelado_cliente)');
    conflitosQuery = barbeiro_id ? conflitosQuery.eq('barbeiro_id', barbeiro_id) : conflitosQuery.is('barbeiro_id', null);
    const { data: ocupados, error: e3 } = await conflitosQuery;
    if (e3) throw e3;

    const start = toMinutes(hora_inicio);
    const end = start + Number(servicoNorm.duracao_minutos || loja.intervalo_minutos || 30);
    if (end >= 1440) {
      return json(res, 400, { erro: 'Esse servico passaria da meia-noite. Escolha um horario mais cedo.' });
    }
    if (isPastAppointment(data_agendamento, start)) {
      return json(res, 400, { erro: 'Esse horario ja passou. Escolha outro horario disponivel.' });
    }
    const dow = dayOfWeek(data_agendamento);
    const { data: horario, error: eHorario } = await supabaseAdmin
      .from('horarios_funcionamento')
      .select('*')
      .eq('barbearia_id', loja.id)
      .eq('dia_semana', dow)
      .maybeSingle();
    if (eHorario) throw eHorario;
    if (!horario || !horario.ativo) {
      return json(res, 400, { erro: 'A barbearia nao atende nesse dia.' });
    }
    const customSlots = customSlotsForDay(loja, dow, barbeiro_id);
    if (customSlots.length) {
      if (!customSlots.includes(hora_inicio)) {
        return json(res, 400, { erro: 'Escolha um dos horarios disponiveis.' });
      }
    } else {
      const open = toMinutes(horario.abre);
      const close = toMinutes(horario.fecha);
      if (start < open || end > close) {
        return json(res, 400, { erro: `Escolha um horario entre ${String(horario.abre).slice(0, 5)} e ${String(horario.fecha).slice(0, 5)}.` });
      }
    }

    const ocupado = (ocupados || []).find(a => {
      const busyStart = toMinutes(String(a.hora_inicio).slice(0, 5));
      const busyEnd = a.hora_fim ? toMinutes(String(a.hora_fim).slice(0, 5)) : busyStart + Number(normalizeServico(a.servicos || {}).duracao_minutos || loja.intervalo_minutos || 30);
      return overlaps(start, end, busyStart, busyEnd);
    });

    if (ocupado) return json(res, 409, { erro: 'Esse horário conflita com outro agendamento. Escolha outro horário.' });

    let clienteId = null;
    const { data: clienteExistente } = await supabaseAdmin
      .from('clientes')
      .select('id')
      .eq('barbearia_id', loja.id)
      .eq('telefone', cliente_whatsapp)
      .maybeSingle();

    if (clienteExistente?.id) {
      clienteId = clienteExistente.id;
      await supabaseAdmin.from('clientes').update({ nome: cliente_nome }).eq('id', clienteId);
    } else {
      const { data: novoCliente, error: e4 } = await supabaseAdmin
        .from('clientes')
        .insert({ barbearia_id: loja.id, nome: cliente_nome, telefone: cliente_whatsapp })
        .select('id')
        .single();
      if (e4) throw e4;
      clienteId = novoCliente.id;
    }

    const payloadAgendamento = {
      barbearia_id: loja.id,
      servico_id,
      barbeiro_id,
      cliente_id: clienteId,
      data_agendamento,
      hora_inicio,
      hora_fim: toTime(end),
      observacao: observacoes,
      status: 'confirmado'
    };
    const slotCancelado = await findCancelledSlot({
      barbeariaId: loja.id,
      barbeiroId: barbeiro_id,
      data: data_agendamento,
      hora: hora_inicio
    });
    const mutation = slotCancelado
      ? supabaseAdmin.from('agendamentos').update(payloadAgendamento).eq('id', slotCancelado.id)
      : supabaseAdmin.from('agendamentos').insert(payloadAgendamento);
    const { data: agendamento, error: e5 } = await mutation
      .select('*')
      .single();
    if (e5) {
      if (isDuplicateSlotError(e5)) {
        return json(res, 409, { erro: 'Esse horario acabou de ser reservado por outra pessoa. Escolha outro horario disponivel.' });
      }
      throw e5;
    }
    const agendamentoView = normalizeAgendamento({
      ...agendamento,
      clientes: { nome: cliente_nome, telefone: cliente_whatsapp },
      servicos: servicoNorm
    });

    const whats = await getWhatsapp(loja.id);
    const avisos = [];

    if (whats) {
      const textoCliente = msgClienteConfirmado({
        barbearia: loja,
        cliente_nome,
        servico_nome: servicoNorm.nome,
        barbeiro_nome: barbeiro?.nome,
        servico_preco_cents: servicoNorm.preco_cents,
        data_agendamento,
        hora_inicio,
        observacao: observacoes
      });
      try {
        const retorno = await sendText({
          apiUrl: whats.evolution_api_url,
          apiKey: whats.evolution_api_key,
          instanceName: whats.instance_name,
          number: cliente_whatsapp,
          text: textoCliente
        });
        await logWhatsapp({ barbearia_id: loja.id, agendamento_id: agendamento.id, destino: cliente_whatsapp, tipo: 'cliente_confirmado', texto: textoCliente, status: 'enviado', retorno });
        avisos.push('cliente');
      } catch (err) {
        await logWhatsapp({ barbearia_id: loja.id, agendamento_id: agendamento.id, destino: cliente_whatsapp, tipo: 'cliente_confirmado', texto: textoCliente, status: 'erro', erro: err.message });
        if (isInvalidWhatsappNumberError(err)) {
          await supabaseAdmin
            .from('agendamentos')
            .update({ status: 'cancelado' })
            .eq('id', agendamento.id);
          return json(res, 400, { erro: 'Esse WhatsApp nao existe ou nao esta ativo. Confira o numero e tente novamente.' });
        }
      }
    }

    return json(res, 201, { sucesso: true, agendamento: agendamentoView, avisos_enviados: avisos });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
