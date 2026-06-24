import { json, method } from '../lib/http.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  return json(res, 200, {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    appUrl: process.env.APP_URL || ''
  });
}
