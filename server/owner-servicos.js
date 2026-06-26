import { json, method, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireOwnerBarbearia } from '../lib/auth.js';
import { normalizeServico, serviceMetaDescription } from '../lib/db-compat.js';

function servicePayload(body) {
  const b = body || {};
  return {
    nome: safeString(b.nome),
    descricao: serviceMetaDescription({
      descricao: b.descricao,
      imagem_url: b.imagem_url,
      precos_barbeiro: b.precos_barbeiro
    }),
    preco: Number(b.preco_cents || 0) / 100,
    duracao_min: Number(b.duracao_minutos || 30),
    ativo: b.ativo !== false
  };
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'PUT', 'DELETE'])) return;
  try {
    const { barbearia } = await requireOwnerBarbearia(req);

    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('servicos').select('*').eq('barbearia_id', barbearia.id).order('nome');
      if (error) throw error;
      return json(res, 200, { servicos: (data || []).map(normalizeServico) });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const { data, error } = await supabaseAdmin.from('servicos').insert({
        barbearia_id: barbearia.id,
        ...servicePayload(b)
      }).select('*').single();
      if (error) throw error;
      return json(res, 201, { sucesso: true, servico: normalizeServico(data) });
    }

    const id = safeString(req.query.id || req.body?.id);
    if (!id) return json(res, 400, { erro: 'ID obrigatório.' });

    if (req.method === 'PUT') {
      const b = req.body || {};
      const { data, error } = await supabaseAdmin.from('servicos').update(servicePayload(b)).eq('id', id).eq('barbearia_id', barbearia.id).select('*').single();
      if (error) throw error;
      return json(res, 200, { sucesso: true, servico: normalizeServico(data) });
    }

    const { error } = await supabaseAdmin.from('servicos').update({ ativo: false }).eq('id', id).eq('barbearia_id', barbearia.id);
    if (error) throw error;
    return json(res, 200, { sucesso: true });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
