import { json, method, normalizePhoneBR, safeString } from './_lib/http.js';
import { supabaseAdmin } from './_lib/supabase.js';
import { requireSaasAdmin } from './_lib/auth.js';

function slugify(v) {
  return safeString(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'PATCH'])) return;
  try {
    await requireSaasAdmin(req);

    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('barbearias').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return json(res, 200, { barbearias: data || [] });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const nome = safeString(b.nome);
      const owner_user_id = safeString(b.owner_user_id);
      if (!nome || !owner_user_id) return json(res, 400, { erro: 'Informe nome e owner_user_id do usuário criado no Supabase Auth.' });
      const { data: barbearia, error } = await supabaseAdmin.from('barbearias').insert({
        owner_user_id,
        nome,
        slug: slugify(b.slug || nome),
        whatsapp_dono: normalizePhoneBR(b.whatsapp_dono),
        plano: safeString(b.plano, 'basico'),
        status: safeString(b.status, 'ativa')
      }).select('*').single();
      if (error) throw error;

      const horarios = [
        [1, true, '08:00', '19:00'], [2, true, '08:00', '19:00'], [3, true, '08:00', '19:00'],
        [4, true, '08:00', '19:00'], [5, true, '08:00', '19:00'], [6, true, '08:00', '17:00'], [0, false, '09:00', '13:00']
      ].map(([dia_semana, ativo, abre, fecha]) => ({ barbearia_id: barbearia.id, dia_semana, ativo, abre, fecha }));
      await supabaseAdmin.from('horarios_funcionamento').insert(horarios);
      await supabaseAdmin.from('servicos').insert([
        { barbearia_id: barbearia.id, nome: 'Corte', preco_cents: 3500, duracao_minutos: 30 },
        { barbearia_id: barbearia.id, nome: 'Barba', preco_cents: 2500, duracao_minutos: 30 },
        { barbearia_id: barbearia.id, nome: 'Corte + Barba', preco_cents: 5500, duracao_minutos: 60 }
      ]);
      await supabaseAdmin.from('barbeiros').insert([{ barbearia_id: barbearia.id, nome: 'Profissional 1' }]);

      return json(res, 201, { sucesso: true, barbearia });
    }

    const id = safeString(req.query.id || req.body?.id);
    if (!id) return json(res, 400, { erro: 'ID obrigatório.' });
    const b = req.body || {};
    const payload = {};
    if (b.status) payload.status = safeString(b.status);
    if (b.plano) payload.plano = safeString(b.plano);
    if (b.nome) payload.nome = safeString(b.nome);
    payload.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('barbearias').update(payload).eq('id', id).select('*').single();
    if (error) throw error;
    return json(res, 200, { sucesso: true, barbearia: data });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
