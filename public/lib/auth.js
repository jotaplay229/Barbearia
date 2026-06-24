import { getBearerToken } from './http.js';
import { supabaseAdmin, supabaseUser } from './supabase.js';

export async function requireUser(req) {
  const token = getBearerToken(req);
  if (!token) {
    const err = new Error('Login obrigatório.');
    err.status = 401;
    throw err;
  }
  const client = supabaseUser(token);
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    const err = new Error('Sessão inválida ou expirada.');
    err.status = 401;
    throw err;
  }
  return data.user;
}

export async function requireSaasAdmin(req) {
  const user = await requireUser(req);
  const allowed = String(process.env.SAAS_ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  if (!allowed.includes(String(user.email || '').toLowerCase())) {
    const err = new Error('Acesso permitido somente ao dono do SaaS.');
    err.status = 403;
    throw err;
  }
  return user;
}

export async function requireOwnerBarbearia(req) {
  const user = await requireUser(req);
  const { data, error } = await supabaseAdmin
    .from('barbearias')
    .select('*')
    .eq('owner_user_id', user.id)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const err = new Error('Este usuário ainda não possui barbearia vinculada.');
    err.status = 404;
    throw err;
  }
  return { user, barbearia: data };
}
