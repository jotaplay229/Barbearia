import { json, method } from './_lib/http.js';
import { supabaseAdmin } from './_lib/supabase.js';
import { requireSaasAdmin } from './_lib/auth.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    await requireSaasAdmin(req);
    const [{ data: barbearias }, { data: agendamentos }] = await Promise.all([
      supabaseAdmin.from('barbearias').select('id,nome,slug,plano,status,created_at'),
      supabaseAdmin.from('agendamentos').select('id,barbearia_id,status,created_at')
    ]);

    const lojas = barbearias || [];
    const ags = agendamentos || [];
    return json(res, 200, {
      total_barbearias: lojas.length,
      ativas: lojas.filter(b => b.status === 'ativa').length,
      suspensas: lojas.filter(b => b.status === 'suspensa').length,
      agendamentos_total: ags.length,
      pendentes: ags.filter(a => a.status === 'pendente').length,
      barbearias: lojas
    });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
