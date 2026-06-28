import { createClient } from '@supabase/supabase-js';
import { json, method, safeString } from '../lib/http.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;

  try {
    const refreshToken = safeString(req.body?.refresh_token);
    if (!refreshToken) {
      return json(res, 400, { erro: 'Sessao sem renovacao disponivel.' });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      return json(res, 500, { erro: 'Supabase nao configurado nas Environment Variables da Vercel.' });
    }

    const supabaseAuth = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const { data, error } = await supabaseAuth.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session?.access_token) {
      return json(res, 401, { erro: error?.message || 'Sessao expirada. Entre novamente.' });
    }

    return json(res, 200, {
      sucesso: true,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: {
        id: data.user?.id,
        email: data.user?.email
      }
    });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message || 'Erro ao renovar sessao.' });
  }
}
