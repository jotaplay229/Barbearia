import { json, method, normalizePhoneBR, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireOwnerBarbearia } from '../lib/auth.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'PUT'])) return;
  try {
    const { barbearia } = await requireOwnerBarbearia(req);

    if (req.method === 'GET') {
      const [{ data: horarios }, { data: whatsapp }] = await Promise.all([
        supabaseAdmin.from('horarios_funcionamento').select('*').eq('barbearia_id', barbearia.id).order('dia_semana'),
        supabaseAdmin.from('barbearia_whatsapp').select('barbearia_id,evolution_api_url,instance_name,ativo,connected_at,updated_at').eq('barbearia_id', barbearia.id).maybeSingle()
      ]);
      return json(res, 200, { barbearia, horarios: horarios || [], whatsapp: whatsapp || null });
    }

    const body = req.body || {};
    const update = {
      nome: safeString(body.nome, barbearia.nome),
      slug: safeString(body.slug, barbearia.slug).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      logo_url: safeString(body.logo_url),
      whatsapp_dono: normalizePhoneBR(body.whatsapp_dono),
      endereco: safeString(body.endereco),
      descricao: safeString(body.descricao),
      intervalo_minutos: Number(body.intervalo_minutos || barbearia.intervalo_minutos || 30),
      cor_primaria: safeString(body.cor_primaria, '#ffffff'),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseAdmin
      .from('barbearias')
      .update(update)
      .eq('id', barbearia.id)
      .select('*')
      .single();
    if (error) throw error;

    if (Array.isArray(body.horarios)) {
      for (const h of body.horarios) {
        await supabaseAdmin
          .from('horarios_funcionamento')
          .upsert({
            barbearia_id: barbearia.id,
            dia_semana: Number(h.dia_semana),
            ativo: !!h.ativo,
            abre: h.abre || '08:00',
            fecha: h.fecha || '18:00'
          }, { onConflict: 'barbearia_id,dia_semana' });
      }
    }

    return json(res, 200, { sucesso: true, barbearia: data });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
