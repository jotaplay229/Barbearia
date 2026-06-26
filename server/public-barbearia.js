import { json, method, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { normalizeBarbearia, normalizeServico } from '../lib/db-compat.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const slug = safeString(req.query.slug);
    if (!slug) return json(res, 400, { erro: 'Slug da barbearia obrigatório.' });

    const { data: barbearia, error } = await supabaseAdmin
      .from('barbearias')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'ativa')
      .maybeSingle();

    if (error) throw error;
    if (!barbearia) return json(res, 404, { erro: 'Barbearia não encontrada ou indisponível.' });
    const loja = normalizeBarbearia(barbearia);

    const [{ data: servicos }, { data: barbeiros }, { data: horarios }] = await Promise.all([
      supabaseAdmin.from('servicos').select('*').eq('barbearia_id', loja.id).eq('ativo', true).order('ordem', { ascending: true }),
      supabaseAdmin.from('barbeiros').select('id,nome,foto_url,ativo').eq('barbearia_id', loja.id).eq('ativo', true).order('nome'),
      supabaseAdmin.from('horarios_funcionamento').select('dia_semana,ativo,abre,fecha').eq('barbearia_id', loja.id).order('dia_semana')
    ]);

    return json(res, 200, { barbearia: loja, servicos: (servicos || []).map(normalizeServico), barbeiros: barbeiros || [], horarios: horarios || [] });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
