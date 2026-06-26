import { json, method, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireOwnerBarbearia } from '../lib/auth.js';
import { connectionState, connectInstance, createInstance, logoutInstance, maskSecret, sendText, setWebhook } from '../lib/evolution.js';
import { normalizeBarbearia } from '../lib/db-compat.js';

function appUrlFromReq(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return process.env.APP_URL || `${proto}://${host}`;
}

function publicWhatsapp(data) {
  if (!data) return null;
  return {
    ...data,
    evolution_api_key: maskSecret(data.evolution_api_key)
  };
}

function isMaskedSecret(value) {
  const key = safeString(value);
  return key.includes('••') || key.includes('â€¢â€¢') || /^\*+$/.test(key);
}

async function getWhatsapp(barbeariaId) {
  const { data, error } = await supabaseAdmin
    .from('barbearia_whatsapp')
    .select('*')
    .eq('barbearia_id', barbeariaId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function saveWhatsapp(barbeariaId, body) {
  const existing = await getWhatsapp(barbeariaId);
  const payload = {
    barbearia_id: barbeariaId,
    evolution_api_url: safeString(body.evolution_api_url),
    instance_name: safeString(body.instance_name),
    ativo: body.ativo !== false,
    updated_at: new Date().toISOString()
  };

  const key = safeString(body.evolution_api_key);
  if (key && !isMaskedSecret(key)) payload.evolution_api_key = key;

  if (!payload.evolution_api_url) throw new Error('Informe a URL da Evolution API.');
  if (!payload.instance_name) throw new Error('Informe o nome da instância.');
  if (!payload.evolution_api_key && !existing?.evolution_api_key) throw new Error('Informe a API Key da Evolution.');

  const { data, error } = await supabaseAdmin
    .from('barbearia_whatsapp')
    .upsert(payload, { onConflict: 'barbearia_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'PUT', 'POST'])) return;
  try {
    const { barbearia } = await requireOwnerBarbearia(req);
    const loja = normalizeBarbearia(barbearia);

    if (req.method === 'GET') {
      const data = await getWhatsapp(loja.id);
      return json(res, 200, { whatsapp: publicWhatsapp(data) });
    }

    if (req.method === 'PUT') {
      const data = await saveWhatsapp(loja.id, req.body || {});
      return json(res, 200, { sucesso: true, whatsapp: publicWhatsapp(data) });
    }

    const body = req.body || {};
    const action = safeString(body.action);

    // Permite salvar e gerar QR em um clique só.
    if (action === 'save-and-qrcode') {
      await saveWhatsapp(loja.id, body);
    }

    const whats = await getWhatsapp(loja.id);
    if (!whats) return json(res, 404, { erro: 'WhatsApp ainda não configurado.' });

    if (action === 'status') {
      const state = await connectionState({
        apiUrl: whats.evolution_api_url,
        apiKey: whats.evolution_api_key,
        instanceName: whats.instance_name
      });

      const statusRaw = JSON.stringify(state).toLowerCase();
      if (statusRaw.includes('open') || statusRaw.includes('connected') || statusRaw.includes('conectado')) {
        await supabaseAdmin
          .from('barbearia_whatsapp')
          .update({ connected_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('barbearia_id', loja.id);
      }

      return json(res, 200, { sucesso: true, state });
    }

    if (action === 'create-instance' || action === 'qrcode' || action === 'save-and-qrcode') {
      const webhookUrl = `${appUrlFromReq(req).replace(/\/$/, '')}/api/evolution-webhook`;
      const number = safeString(body.number || loja.whatsapp_dono);

      const created = await createInstance({
        apiUrl: whats.evolution_api_url,
        apiKey: whats.evolution_api_key,
        instanceName: whats.instance_name,
        webhookUrl,
        number
      });

      let webhook = null;
      try {
        webhook = await setWebhook({
          apiUrl: whats.evolution_api_url,
          apiKey: whats.evolution_api_key,
          instanceName: whats.instance_name,
          webhookUrl
        });
      } catch (err) {
        webhook = { erro: err.message };
      }

      const qr = await connectInstance({
        apiUrl: whats.evolution_api_url,
        apiKey: whats.evolution_api_key,
        instanceName: whats.instance_name,
        number
      });

      return json(res, 200, {
        sucesso: true,
        message: qr.qrDataUrl ? 'QR Code gerado. Escaneie pelo WhatsApp do dono.' : 'Instância criada, mas a Evolution não retornou QR Code ainda. Tente atualizar em alguns segundos.',
        created,
        webhook,
        qrcode: qr,
        webhookUrl
      });
    }

    if (action === 'refresh-qrcode') {
      const qr = await connectInstance({
        apiUrl: whats.evolution_api_url,
        apiKey: whats.evolution_api_key,
        instanceName: whats.instance_name,
        number: safeString(body.number || loja.whatsapp_dono)
      });
      return json(res, 200, { sucesso: true, qrcode: qr });
    }

    if (action === 'logout') {
      const retorno = await logoutInstance({
        apiUrl: whats.evolution_api_url,
        apiKey: whats.evolution_api_key,
        instanceName: whats.instance_name
      });
      await supabaseAdmin
        .from('barbearia_whatsapp')
        .update({ connected_at: null, updated_at: new Date().toISOString() })
        .eq('barbearia_id', loja.id);
      return json(res, 200, { sucesso: true, retorno });
    }

    if (action === 'test') {
      const number = safeString(body.number) || loja.whatsapp_dono;
      if (!number) return json(res, 400, { erro: 'Informe um número para teste.' });
      const retorno = await sendText({
        apiUrl: whats.evolution_api_url,
        apiKey: whats.evolution_api_key,
        instanceName: whats.instance_name,
        number,
        text: `✅ Teste do ${loja.nome}\n\nSeu WhatsApp está conectado ao BarberOS.`
      });
      return json(res, 200, { sucesso: true, retorno });
    }

    return json(res, 400, { erro: 'Ação inválida.' });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
