import { createClient } from '@supabase/supabase-js';
import { json, method, safeString } from '../lib/http.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;

  try {
    const body = req.body || {};
    const email = safeString(body.email).toLowerCase();
    const password = safeString(body.password);
    const area = safeString(body.area, 'owner');

    if (!email || !password) {
      return json(res, 400, { erro: 'Informe e-mail e senha.' });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      return json(res, 500, { erro: 'Supabase não configurado nas Environment Variables da Vercel.' });
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

    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (error || !data?.session?.access_token) {
      return json(res, 401, { erro: error?.message || 'Login inválido.' });
    }

    if (area === 'saas') {
      const allowed = String(process.env.SAAS_ADMIN_EMAILS || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean);

      if (!allowed.includes(email)) {
        return json(res, 403, { erro: 'Este e-mail não está liberado como dono do SaaS.' });
      }
    }

    return json(res, 200, {
      sucesso: true,
      access_token: data.session.access_token,
      expires_at: data.session.expires_at,
      user: {
        id: data.user?.id,
        email: data.user?.email
      }
    });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message || 'Erro no login.' });
  }
}
