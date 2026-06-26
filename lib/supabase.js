import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

function missingSupabaseClient(reason) {
  return new Proxy({}, {
    get() {
      throw new Error(reason);
    }
  });
}

const missingMessage = 'Supabase não configurado. Confira SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY na Vercel.';

if (!url || !anon || !service) {
  console.warn(missingMessage);
}

export const supabaseAdmin = url && service
  ? createClient(url, service, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : missingSupabaseClient(missingMessage);

export function supabaseUser(token) {
  if (!url || !anon) {
    throw new Error(missingMessage);
  }

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
