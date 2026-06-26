import { json, method, normalizePhoneBR, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireOwnerBarbearia } from '../lib/auth.js';
import { normalizeBarbearia, storeMetaDescription } from '../lib/db-compat.js';

function cleanTimes(value) {
  const arr = Array.isArray(value) ? value : String(value || '').split(/[,\n;]/);
  return [...new Set(arr
    .map(v => safeString(v).slice(0, 5))
    .filter(v => /^\d{2}:\d{2}$/.test(v))
    .sort())];
}

function cleanCustomHours(value) {
  const out = {};
  const source = value && typeof value === 'object' ? value : {};
  for (let d = 0; d <= 6; d++) {
    out[d] = cleanTimes(source[d] || source[String(d)] || []);
  }
  return out;
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'PUT'])) return;
  try {
    const { barbearia } = await requireOwnerBarbearia(req);
    const loja = normalizeBarbearia(barbearia);

    if (req.method === 'GET') {
      const [{ data: horarios }, { data: whatsapp }] = await Promise.all([
        supabaseAdmin.from('horarios_funcionamento').select('*').eq('barbearia_id', barbearia.id).order('dia_semana'),
        supabaseAdmin.from('barbearia_whatsapp').select('barbearia_id,evolution_api_url,instance_name,ativo,connected_at,updated_at').eq('barbearia_id', barbearia.id).maybeSingle()
      ]);
      return json(res, 200, { barbearia: loja, horarios: horarios || [], whatsapp: whatsapp || null });
    }

    const body = req.body || {};
    const horariosCustom = cleanCustomHours(body.horarios_custom || loja.horarios_custom);
    const update = {
      nome: safeString(body.nome, loja.nome),
      slug: safeString(body.slug, loja.slug).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      logo_url: safeString(body.logo_url),
      telefone_whatsapp: normalizePhoneBR(body.whatsapp_dono),
      endereco: safeString(body.endereco),
      descricao: storeMetaDescription({ descricao: safeString(body.descricao, loja.descricao), horarios_custom: horariosCustom }),
      intervalo_minutos: Math.max(1, Number(body.intervalo_minutos || loja.intervalo_minutos || 30)),
      cor_principal: safeString(body.cor_primaria, '#ffffff')
    };

    const { data, error } = await supabaseAdmin
      .from('barbearias')
      .update(update)
      .eq('id', loja.id)
      .select('*')
      .single();
    if (error) throw error;

    if (Array.isArray(body.horarios)) {
      for (const h of body.horarios) {
        await supabaseAdmin
          .from('horarios_funcionamento')
          .upsert({
            barbearia_id: loja.id,
            dia_semana: Number(h.dia_semana),
            ativo: !!h.ativo,
            abre: h.abre || '08:00',
            fecha: h.fecha || '18:00'
          }, { onConflict: 'barbearia_id,dia_semana' });
      }
    }

    return json(res, 200, { sucesso: true, barbearia: normalizeBarbearia(data) });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
