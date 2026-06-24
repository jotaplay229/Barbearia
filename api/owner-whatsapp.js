import { json, method, safeString } from './_lib/http.js';
import { supabaseAdmin } from './_lib/supabase.js';
import { requireOwnerBarbearia } from './_lib/auth.js';
import { connectionState, maskSecret, sendText } from './_lib/evolution.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'PUT', 'POST'])) return;
  try {
    const { barbearia } = await requireOwnerBarbearia(req);

    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('barbearia_whatsapp')
        .select('*')
        .eq('barbearia_id', barbearia.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return json(res, 200, { whatsapp: null });
      return json(res, 200, { whatsapp: { ...data, evolution_api_key: maskSecret(data.evolution_api_key) } });
    }

    if (req.method === 'PUT') {
      const body = req.body || {};
      const payload = {
        barbearia_id: barbearia.id,
        evolution_api_url: safeString(body.evolution_api_url),
        instance_name: safeString(body.instance_name),
        ativo: body.ativo !== false,
        updated_at: new Date().toISOString()
      };
      if (safeString(body.evolution_api_key) && !safeString(body.evolution_api_key).includes('••')) {
        payload.evolution_api_key = safeString(body.evolution_api_key);
      }

      const { data, error } = await supabaseAdmin
        .from('barbearia_whatsapp')
        .upsert(payload, { onConflict: 'barbearia_id' })
        .select('*')
        .single();
      if (error) throw error;
      return json(res, 200, { sucesso: true, whatsapp: { ...data, evolution_api_key: maskSecret(data.evolution_api_key) } });
    }

    const body = req.body || {};
    const action = safeString(body.action);
    const { data: whats, error } = await supabaseAdmin
      .from('barbearia_whatsapp')
      .select('*')
      .eq('barbearia_id', barbearia.id)
      .maybeSingle();
    if (error) throw error;
    if (!whats) return json(res, 404, { erro: 'WhatsApp ainda não configurado.' });

    if (action === 'status') {
      const state = await connectionState({ apiUrl: whats.evolution_api_url, apiKey: whats.evolution_api_key, instanceName: whats.instance_name });
      return json(res, 200, { sucesso: true, state });
    }

    if (action === 'test') {
      const number = safeString(body.number) || barbearia.whatsapp_dono;
      if (!number) return json(res, 400, { erro: 'Informe um número para teste.' });
      const retorno = await sendText({
        apiUrl: whats.evolution_api_url,
        apiKey: whats.evolution_api_key,
        instanceName: whats.instance_name,
        number,
        text: `✅ Teste do ${barbearia.nome}\n\nSeu WhatsApp está conectado ao BarberOS.`
      });
      return json(res, 200, { sucesso: true, retorno });
    }

    return json(res, 400, { erro: 'Ação inválida.' });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
