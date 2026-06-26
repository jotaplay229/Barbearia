import { normalizePhoneBR } from './http.js';

export function normalizeBarbearia(row = {}) {
  return {
    ...row,
    whatsapp_dono: row.whatsapp_dono || row.telefone_whatsapp || '',
    cor_primaria: row.cor_primaria || row.cor_principal || '#ffffff',
    ativo: row.ativo !== false,
    status: row.status || (row.ativo === false ? 'suspensa' : 'ativa'),
    plano: row.plano || 'pro'
  };
}

export function normalizeServico(row = {}) {
  const precoCents = row.preco_cents ?? Math.round(Number(row.preco || 0) * 100);
  return {
    ...row,
    preco_cents: Number(precoCents || 0),
    duracao_minutos: Number(row.duracao_minutos || row.duracao_min || 30)
  };
}

export function normalizeCliente(row = {}) {
  return {
    ...row,
    whatsapp: row.whatsapp || row.telefone || '',
    telefone: row.telefone || row.whatsapp || ''
  };
}

export function normalizeAgendamento(row = {}) {
  const cliente = row.clientes || row.cliente || {};
  return {
    ...row,
    cliente_nome: row.cliente_nome || cliente.nome || '',
    cliente_whatsapp: row.cliente_whatsapp || cliente.whatsapp || cliente.telefone || '',
    observacoes: row.observacoes || row.observacao || '',
    servicos: row.servicos ? normalizeServico(row.servicos) : row.servicos,
    hora_inicio: String(row.hora_inicio || '').slice(0, 5)
  };
}

export function isMissingColumn(error) {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === 'PGRST204' || msg.includes('could not find') || msg.includes('schema cache') || msg.includes('column');
}

export function barbeariaInsertPayload(body) {
  return {
    owner_user_id: body.owner_user_id,
    nome: body.nome,
    slug: body.slug,
    telefone_whatsapp: normalizePhoneBR(body.whatsapp_dono),
    status: body.status || 'ativa',
    ativo: body.status !== 'suspensa'
  };
}

export function barbeariaUpdatePayload(body) {
  const payload = {};
  if (body.nome !== undefined) payload.nome = body.nome;
  if (body.slug !== undefined) payload.slug = body.slug;
  if (body.status !== undefined) {
    payload.status = body.status;
    payload.ativo = body.status !== 'suspensa';
  }
  if (body.whatsapp_dono !== undefined) payload.telefone_whatsapp = normalizePhoneBR(body.whatsapp_dono);
  return payload;
}

export function whatsappLogPayload(payload) {
  return {
    barbearia_id: payload.barbearia_id,
    agendamento_id: payload.agendamento_id,
    numero: payload.destino,
    tipo: payload.tipo,
    mensagem: payload.texto,
    status: payload.status,
    resposta: payload.retorno || null,
    erro: payload.erro || null
  };
}
