import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon || !service) {
  console.warn('Variáveis do Supabase ainda não configuradas. Confira .env.local ou Environment Variables na Vercel.');
}

export const supabaseAdmin = createClient(url, service, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

export function supabaseUser(token) {
  return createClient(url, anon, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
