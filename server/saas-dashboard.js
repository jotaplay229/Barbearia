import { json, method } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSaasAdmin } from '../lib/auth.js';
import { normalizeBarbearia } from '../lib/db-compat.js';

function saoPauloNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return { date, minutes, dow };
}

function toMinutes(time) {
  const [h, m] = String(time || '00:00').slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

async function listAuthUsersMap() {
  const map = new Map();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data?.users || []) map.set(user.id, user);
    if ((data?.users || []).length < 1000) break;
  }
  return map;
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    await requireSaasAdmin(req);

    const now = saoPauloNow();
    const [{ data: barbearias }, { data: horarios }, { data: whatsapps }, { data: agHoje }, { data: whatsappLogs }] = await Promise.all([
      supabaseAdmin.from('barbearias').select('*').order('created_at', { ascending: false }),
      supabaseAdmin.from('horarios_funcionamento').select('barbearia_id,dia_semana,ativo,abre,fecha').eq('dia_semana', now.dow),
      supabaseAdmin.from('barbearia_whatsapp').select('barbearia_id,instance_name,ativo,connected_at,updated_at'),
      supabaseAdmin.from('agendamentos').select('id,barbearia_id,status,data_agendamento,hora_inicio,created_at,clientes(nome,telefone)').eq('data_agendamento', now.date),
      supabaseAdmin.from('whatsapp_logs').select('*').order('created_at', { ascending: false }).limit(15)
    ]);

    const users = await listAuthUsersMap();
    const lojas = (barbearias || []).map(normalizeBarbearia);
    const agsHoje = agHoje || [];
    const horariosByStore = new Map((horarios || []).map(h => [h.barbearia_id, h]));
    const whatsByStore = new Map((whatsapps || []).map(w => [w.barbearia_id, w]));

    const barbeariasView = lojas.map(loja => {
      const owner = users.get(loja.owner_user_id);
      const horario = horariosByStore.get(loja.id);
      const whatsapp = whatsByStore.get(loja.id);
      const aberta = !!(
        loja.status === 'ativa' &&
        horario?.ativo &&
        now.minutes >= toMinutes(horario.abre) &&
        now.minutes < toMinutes(horario.fecha)
      );
      const agendamentosHoje = agsHoje.filter(ag => ag.barbearia_id === loja.id);

      return {
        ...loja,
        online: loja.status === 'ativa',
        aberta,
        horario_hoje: horario || null,
        whatsapp_configurado: !!whatsapp,
        whatsapp_conectado: !!whatsapp?.connected_at,
        whatsapp_instance: whatsapp?.instance_name || '',
        agendamentos_hoje: agendamentosHoje.length,
        pendentes_hoje: agendamentosHoje.filter(ag => ag.status === 'pendente').length,
        owner: {
          id: loja.owner_user_id,
          email: owner?.email || '',
          nome: owner?.user_metadata?.nome || owner?.user_metadata?.name || '',
          created_at: owner?.created_at || ''
        }
      };
    });

    const donos = barbeariasView.map(loja => ({
      user_id: loja.owner_user_id,
      nome: loja.owner.nome,
      email: loja.owner.email,
      created_at: loja.owner.created_at,
      barbearia_id: loja.id,
      barbearia_nome: loja.nome,
      slug: loja.slug,
      status: loja.status
    }));

    const logs = [
      ...agsHoje.slice(0, 12).map(ag => ({
        id: `ag-${ag.id}`,
        barbearia_id: ag.barbearia_id,
        tipo: 'agendamento',
        status: ag.status,
        detalhe: `${ag.cliente_nome || ag.clientes?.nome || 'Cliente'} - ${String(ag.hora_inicio).slice(0, 5)}`,
        created_at: ag.created_at
      })),
      ...(whatsappLogs || []).map(log => ({
        id: `wa-${log.id}`,
        barbearia_id: log.barbearia_id,
        tipo: `whatsapp_${log.tipo || 'evento'}`,
        status: log.status,
        detalhe: log.erro || log.mensagem || log.tipo || 'evento',
        created_at: log.created_at
      }))
    ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 20);

    return json(res, 200, {
      hoje: now.date,
      total_barbearias: barbeariasView.length,
      online: barbeariasView.filter(b => b.online).length,
      abertas_agora: barbeariasView.filter(b => b.aberta).length,
      suspensas: barbeariasView.filter(b => b.status === 'suspensa').length,
      agendamentos_hoje: agsHoje.length,
      pendentes_hoje: agsHoje.filter(a => a.status === 'pendente').length,
      whatsapp_conectados: barbeariasView.filter(b => b.whatsapp_conectado).length,
      barbearias: barbeariasView,
      donos,
      logs
    });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
