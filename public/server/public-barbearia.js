import { json, method, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const slug = safeString(req.query.slug);
    if (!slug) return json(res, 400, { erro: 'Slug da barbearia obrigatório.' });

    const { data: barbearia, error } = await supabaseAdmin
      .from('barbearias')
      .select('id,nome,slug,logo_url,whatsapp_dono,endereco,descricao,status,intervalo_minutos,cor_primaria')
      .eq('slug', slug)
      .eq('status', 'ativa')
      .maybeSingle();

    if (error) throw error;
    if (!barbearia) return json(res, 404, { erro: 'Barbearia não encontrada ou indisponível.' });

    const [{ data: servicos }, { data: barbeiros }, { data: horarios }] = await Promise.all([
      supabaseAdmin.from('servicos').select('id,nome,descricao,preco_cents,duracao_minutos').eq('barbearia_id', barbearia.id).eq('ativo', true).order('nome'),
      supabaseAdmin.from('barbeiros').select('id,nome,foto_url,ativo').eq('barbearia_id', barbearia.id).eq('ativo', true).order('nome'),
      supabaseAdmin.from('horarios_funcionamento').select('dia_semana,ativo,abre,fecha').eq('barbearia_id', barbearia.id).order('dia_semana')
    ]);

    return json(res, 200, { barbearia, servicos: servicos || [], barbeiros: barbeiros || [], horarios: horarios || [] });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
