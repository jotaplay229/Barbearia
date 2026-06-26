import { json, method, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSaasAdmin } from '../lib/auth.js';

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

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    nome: user.user_metadata?.nome || user.user_metadata?.name || '',
    created_at: user.created_at,
    updated_at: user.updated_at
  };
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'PATCH'])) return;

  try {
    await requireSaasAdmin(req);

    if (req.method === 'GET') {
      const { data: barbearias, error } = await supabaseAdmin
        .from('barbearias')
        .select('id,nome,slug,status,owner_user_id,created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const users = await listAuthUsersMap();
      const donos = (barbearias || []).map(loja => {
        const user = users.get(loja.owner_user_id);
        return {
          user_id: loja.owner_user_id,
          nome: user?.user_metadata?.nome || user?.user_metadata?.name || '',
          email: user?.email || '',
          created_at: user?.created_at || loja.created_at,
          barbearia_id: loja.id,
          barbearia_nome: loja.nome,
          slug: loja.slug,
          status: loja.status
        };
      });

      return json(res, 200, { donos });
    }

    const body = req.body || {};
    const userId = safeString(req.query.user_id || body.user_id);
    if (!userId) return json(res, 400, { erro: 'ID do usuário é obrigatório.' });

    const payload = {};
    const email = safeString(body.email).toLowerCase();
    const password = safeString(body.password);
    const nome = safeString(body.nome);

    if (email) {
      payload.email = email;
      payload.email_confirm = true;
    }
    if (password) {
      if (password.length < 6) return json(res, 400, { erro: 'A senha precisa ter pelo menos 6 caracteres.' });
      payload.password = password;
    }
    if (nome) {
      payload.user_metadata = { nome };
    }

    if (!Object.keys(payload).length) return json(res, 400, { erro: 'Informe e-mail, senha ou nome para alterar.' });

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, payload);
    if (error) throw error;

    return json(res, 200, { sucesso: true, user: publicUser(data?.user) });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
