import { normalizePhoneBR } from './http.js';

const SERVICE_META_PREFIX = 'BARBEROS_META:';

function parseServiceMeta(value) {
  const text = String(value || '');
  if (!text.startsWith(SERVICE_META_PREFIX)) return { descricao: text, imagem_url: '', precos_barbeiro: {} };
  try {
    const meta = JSON.parse(text.slice(SERVICE_META_PREFIX.length));
    return {
      descricao: meta.descricao || '',
      imagem_url: meta.imagem_url || '',
      precos_barbeiro: meta.precos_barbeiro || {}
    };
  } catch {
    return { descricao: '', imagem_url: '', precos_barbeiro: {} };
  }
}

export function serviceMetaDescription({ descricao, imagem_url, precos_barbeiro } = {}) {
  return SERVICE_META_PREFIX + JSON.stringify({
    descricao: String(descricao || '').trim(),
    imagem_url: String(imagem_url || '').trim(),
    precos_barbeiro: precos_barbeiro || {}
  });
}

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
  const meta = parseServiceMeta(row.descricao);
  const precoCents = row.preco_cents ?? Math.round(Number(row.preco || 0) * 100);
  return {
    ...row,
    descricao: meta.descricao,
    imagem_url: row.imagem_url || row.image_url || meta.imagem_url || '',
    precos_barbeiro: row.precos_barbeiro || meta.precos_barbeiro || {},
    preco_cents: Number(precoCents || 0),
    duracao_minutos: Number(row.duracao_minutos || row.duracao_min || 30)
  };
}

export function serviceForBarber(servico, barbeiroId) {
  const base = normalizeServico(servico || {});
  const cfg = base.precos_barbeiro?.[barbeiroId] || {};
  const preco = cfg.preco_cents ?? cfg.preco ?? base.preco_cents;
  const duracao = cfg.duracao_minutos ?? cfg.duracao_min ?? base.duracao_minutos;
  return {
    ...base,
    preco_cents: Number(preco || 0),
    duracao_minutos: Number(duracao || base.duracao_minutos || 30),
    disponivel_para_barbeiro: cfg.ativo !== false
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
