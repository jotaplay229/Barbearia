import { json, method, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSaasAdmin } from '../lib/auth.js';
import { barbeariaInsertPayload, barbeariaUpdatePayload } from '../lib/db-compat.js';

function slugify(v) {
  return safeString(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function findAuthUserByEmail(email) {
  const target = safeString(email).toLowerCase();
  if (!target) return null;

  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;

    const found = (data?.users || []).find(user => String(user.email || '').toLowerCase() === target);
    if (found) return found;
    if ((data?.users || []).length < 1000) break;
  }

  return null;
}

async function ensureOwnerUser(body) {
  const owner_user_id = safeString(body.owner_user_id);
  if (owner_user_id) return { userId: owner_user_id, user: null, created: false };

  const email = safeString(body.owner_email || body.email).toLowerCase();
  const password = safeString(body.owner_password || body.password);
  const ownerName = safeString(body.owner_nome || body.owner_name || body.nome_dono);

  if (!email || !password) {
    const err = new Error('Informe e-mail e senha do dono, ou um owner_user_id já existente.');
    err.status = 400;
    throw err;
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      nome: ownerName,
      origem: 'barberos_saas'
    }
  });

  if (!error && data?.user?.id) {
    return { userId: data.user.id, user: data.user, created: true };
  }

  const msg = String(error?.message || '').toLowerCase();
  if (msg.includes('already') || msg.includes('registered') || msg.includes('exists') || msg.includes('existe')) {
    const existing = await findAuthUserByEmail(email);
    if (existing?.id) return { userId: existing.id, user: existing, created: false, reused: true };
  }

  throw error || new Error('Não foi possível criar o usuário do dono no Supabase Auth.');
}

async function insertDefaults(barbeariaId) {
  const horarios = [
    [1, true, '08:00', '19:00'], [2, true, '08:00', '19:00'], [3, true, '08:00', '19:00'],
    [4, true, '08:00', '19:00'], [5, true, '08:00', '19:00'], [6, true, '08:00', '17:00'], [0, false, '09:00', '13:00']
  ].map(([dia_semana, ativo, abre, fecha]) => ({ barbearia_id: barbeariaId, dia_semana, ativo, abre, fecha }));

  const results = await Promise.all([
    supabaseAdmin.from('horarios_funcionamento').insert(horarios),
    supabaseAdmin.from('servicos').insert([
      { barbearia_id: barbeariaId, nome: 'Corte', preco: 35, duracao_min: 30, ativo: true, ordem: 1 },
      { barbearia_id: barbeariaId, nome: 'Barba', preco: 25, duracao_min: 30, ativo: true, ordem: 2 },
      { barbearia_id: barbeariaId, nome: 'Corte + Barba', preco: 55, duracao_min: 60, ativo: true, ordem: 3 }
    ]),
    supabaseAdmin.from('barbeiros').insert([{ barbearia_id: barbeariaId, nome: 'Profissional 1' }])
  ]);

  const failed = results.find(result => result.error);
  if (failed?.error) throw failed.error;
}

async function cleanupBarbearia(id) {
  try {
    await supabaseAdmin.from('barbearias').delete().eq('id', id);
  } catch {
    // O erro original do cadastro é mais importante do que uma falha de limpeza.
  }
}

async function deleteRowsByStore(table, id) {
  const { error } = await supabaseAdmin.from(table).delete().eq('barbearia_id', id);
  if (error) throw error;
}

async function deleteBarbearia(id) {
  const { data: loja, error: findError } = await supabaseAdmin
    .from('barbearias')
    .select('id,nome,owner_user_id')
    .eq('id', id)
    .maybeSingle();
  if (findError) throw findError;
  if (!loja) {
    const err = new Error('Barbearia nao encontrada.');
    err.status = 404;
    throw err;
  }

  for (const table of [
    'whatsapp_logs',
    'agendamentos',
    'clientes',
    'barbearia_whatsapp',
    'horarios_funcionamento',
    'servicos',
    'barbeiros'
  ]) {
    await deleteRowsByStore(table, id);
  }

  const { error: deleteError } = await supabaseAdmin.from('barbearias').delete().eq('id', id);
  if (deleteError) throw deleteError;

  if (loja.owner_user_id) {
    const { data: otherStores, error: otherError } = await supabaseAdmin
      .from('barbearias')
      .select('id')
      .eq('owner_user_id', loja.owner_user_id)
      .limit(1);
    if (otherError) throw otherError;
    if (!otherStores?.length) {
      await supabaseAdmin.auth.admin.deleteUser(loja.owner_user_id).catch(() => {});
    }
  }

  return loja;
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
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
      if (!nome) return json(res, 400, { erro: 'Informe o nome da barbearia.' });

      const slug = slugify(b.slug || nome);
      if (!slug) return json(res, 400, { erro: 'Informe um slug válido para a barbearia.' });

      const { data: existingSlug, error: slugError } = await supabaseAdmin
        .from('barbearias')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (slugError) throw slugError;
      if (existingSlug) return json(res, 409, { erro: 'Já existe uma barbearia com esse slug/link.' });

      const owner = await ensureOwnerUser(b);
      const { data: existingOwner, error: ownerError } = await supabaseAdmin
        .from('barbearias')
        .select('id,nome')
        .eq('owner_user_id', owner.userId)
        .maybeSingle();
      if (ownerError) throw ownerError;
      if (existingOwner) return json(res, 409, { erro: `Esse dono já está vinculado à barbearia ${existingOwner.nome}.` });

      const insertPayload = barbeariaInsertPayload({
        owner_user_id: owner.userId,
        nome,
        slug,
        whatsapp_dono: b.whatsapp_dono,
        status: safeString(b.status) || 'ativa'
      });

      const { data: barbearia, error } = await supabaseAdmin.from('barbearias').insert(insertPayload).select('*').single();
      if (error) {
        if (owner.created) await supabaseAdmin.auth.admin.deleteUser(owner.userId).catch(() => {});
        throw error;
      }

      try {
        await insertDefaults(barbearia.id);
      } catch (seedError) {
        await cleanupBarbearia(barbearia.id);
        if (owner.created) await supabaseAdmin.auth.admin.deleteUser(owner.userId).catch(() => {});
        throw seedError;
      }

      return json(res, 201, {
        sucesso: true,
        barbearia,
        owner: {
          id: owner.userId,
          email: owner.user?.email || safeString(b.owner_email || b.email).toLowerCase(),
          criado: owner.created,
          reutilizado: !!owner.reused
        }
      });
    }

    const id = safeString(req.query.id || req.body?.id);
    if (!id) return json(res, 400, { erro: 'ID obrigatório.' });
    if (req.method === 'DELETE') {
      const loja = await deleteBarbearia(id);
      return json(res, 200, { sucesso: true, barbearia: loja });
    }

    const b = req.body || {};
    const payload = barbeariaUpdatePayload({
      nome: b.nome !== undefined ? safeString(b.nome) : undefined,
      status: b.status ? safeString(b.status) : undefined,
      whatsapp_dono: b.whatsapp_dono !== undefined ? b.whatsapp_dono : undefined
    });
    if (b.slug) {
      const slug = slugify(b.slug);
      if (!slug) return json(res, 400, { erro: 'Informe um slug válido.' });
      const { data: existingSlug, error: slugError } = await supabaseAdmin
        .from('barbearias')
        .select('id')
        .eq('slug', slug)
        .neq('id', id)
        .maybeSingle();
      if (slugError) throw slugError;
      if (existingSlug) return json(res, 409, { erro: 'Já existe uma barbearia com esse slug/link.' });
      payload.slug = slug;
    }
    const { data, error } = await supabaseAdmin.from('barbearias').update(payload).eq('id', id).select('*').single();
    if (error) throw error;
    return json(res, 200, { sucesso: true, barbearia: data });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
