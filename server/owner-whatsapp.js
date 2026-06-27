import { json, method, normalizePhoneBR, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireOwnerBarbearia } from '../lib/auth.js';
import { connectionState, connectInstance, createInstance, logoutInstance, maskSecret, normalizeQrPayload, sendText, setInstanceSettings, setWebhook } from '../lib/evolution.js';
import { normalizeBarbearia } from '../lib/db-compat.js';

function appUrlFromReq(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return process.env.APP_URL || `${proto}://${host}`;
}

function slugify(value, fallback = 'loja') {
  const slug = safeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-+/g, '-');
  return slug || fallback;
}

function instanceNameFor(loja) {
  const prefix = slugify(process.env.EVOLUTION_INSTANCE_PREFIX || 'barbearia', 'barbearia');
  const base = slugify(loja.slug || loja.nome || loja.id, 'loja');
  return `${prefix}-${base}`.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
}

function envEvolutionConfig() {
  return {
    apiUrl: safeString(process.env.EVOLUTION_API_URL || process.env.EVOLUTION_URL),
    apiKey: safeString(process.env.EVOLUTION_API_KEY || process.env.EVOLUTION_GLOBAL_API_KEY || process.env.GLOBAL_API_KEY)
  };
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
  return key.includes('*') || key.includes('...') || /^x+$/i.test(key);
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

function buildWhatsappPayload(loja, existing = null, body = {}) {
  const env = envEvolutionConfig();
  const bodyKey = safeString(body.evolution_api_key);
  const bodyUrl = safeString(body.evolution_api_url);
  const instanceName = instanceNameFor(loja);
  const sameConnection =
    existing?.instance_name === instanceName &&
    existing?.evolution_api_url === (env.apiUrl || bodyUrl || existing?.evolution_api_url || '');

  return {
    barbearia_id: loja.id,
    evolution_api_url: env.apiUrl || bodyUrl || existing?.evolution_api_url || '',
    evolution_api_key: env.apiKey || (!isMaskedSecret(bodyKey) ? bodyKey : '') || existing?.evolution_api_key || '',
    instance_name: instanceName,
    ativo: body.ativo !== false,
    connected_at: sameConnection ? existing?.connected_at || null : null,
    updated_at: new Date().toISOString()
  };
}

function assertEvolutionConfig(payload) {
  if (!payload.evolution_api_url || !payload.evolution_api_key) {
    throw new Error('WhatsApp ainda nao esta configurado. Fale com o suporte.');
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(payload.evolution_api_url)) {
    throw new Error('A conexao do WhatsApp ainda esta apontando para um endereco local. Fale com o suporte para publicar a conexao.');
  }
  if (!payload.instance_name) {
    throw new Error('Nao foi possivel gerar o nome da instancia da loja.');
  }
}

async function saveWhatsapp(loja, body = {}) {
  const existing = await getWhatsapp(loja.id);
  const payload = buildWhatsappPayload(loja, existing, body);
  assertEvolutionConfig(payload);

  const { data, error } = await supabaseAdmin
    .from('barbearia_whatsapp')
    .upsert(payload, { onConflict: 'barbearia_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function saveOwnerPhone(loja, number) {
  const phone = normalizePhoneBR(number);
  if (!phone) return safeString(loja.whatsapp_dono);
  if (phone === normalizePhoneBR(loja.whatsapp_dono)) return phone;

  const { error } = await supabaseAdmin
    .from('barbearias')
    .update({ telefone_whatsapp: phone })
    .eq('id', loja.id);
  if (error) throw error;
  loja.whatsapp_dono = phone;
  return phone;
}

async function allowCalls(whats) {
  try {
    return await setInstanceSettings({
      apiUrl: whats.evolution_api_url,
      apiKey: whats.evolution_api_key,
      instanceName: whats.instance_name
    });
  } catch (err) {
    return {
      aviso: 'Nao foi possivel liberar ligacoes automaticamente agora.',
      erro: err.message
    };
  }
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'PUT', 'POST'])) return;
  try {
    const { barbearia } = await requireOwnerBarbearia(req);
    const loja = normalizeBarbearia(barbearia);

    if (req.method === 'GET') {
      const data = await getWhatsapp(loja.id);
      const preview = data || buildWhatsappPayload(loja, null, {});
      const settings = data ? await allowCalls(data) : null;
      return json(res, 200, { whatsapp: publicWhatsapp(preview), settings });
    }

    if (req.method === 'PUT') {
      const body = req.body || {};
      await saveOwnerPhone(loja, body.number || loja.whatsapp_dono);
      const data = await saveWhatsapp(loja, body);
      return json(res, 200, { sucesso: true, whatsapp: publicWhatsapp(data) });
    }

    const body = req.body || {};
    const action = safeString(body.action);
    const autoConfigActions = ['status', 'create-instance', 'qrcode', 'save-and-qrcode', 'refresh-qrcode', 'test'];

    if (autoConfigActions.includes(action)) {
      await saveOwnerPhone(loja, body.number || loja.whatsapp_dono);
    }

    const whats = autoConfigActions.includes(action)
      ? await saveWhatsapp(loja, body)
      : await getWhatsapp(loja.id);

    if (!whats) return json(res, 404, { erro: 'WhatsApp ainda nao configurado.' });

    if (action === 'status') {
      const settings = await allowCalls(whats);
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

      return json(res, 200, { sucesso: true, state, settings, whatsapp: publicWhatsapp(whats) });
    }

    if (action === 'create-instance' || action === 'qrcode' || action === 'save-and-qrcode') {
      const webhookUrl = `${appUrlFromReq(req).replace(/\/$/, '')}/api/evolution-webhook`;
      const number = safeString(body.number || loja.whatsapp_dono);
      if (!number) return json(res, 400, { erro: 'Informe o numero do WhatsApp da barbearia.' });

      const created = await createInstance({
        apiUrl: whats.evolution_api_url,
        apiKey: whats.evolution_api_key,
        instanceName: whats.instance_name,
        webhookUrl,
        number
      });

      let createdQr = null;
      try {
        createdQr = await normalizeQrPayload(created);
      } catch {
        createdQr = null;
      }

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

      const settings = await allowCalls(whats);

      let connectedQr = null;
      let connectError = null;
      try {
        connectedQr = await connectInstance({
          apiUrl: whats.evolution_api_url,
          apiKey: whats.evolution_api_key,
          instanceName: whats.instance_name,
          number
        });
      } catch (err) {
        connectError = err.message;
        if (!createdQr?.qrDataUrl && !createdQr?.qrText && !createdQr?.pairingCode) throw err;
      }
      const qr = connectedQr?.qrDataUrl || connectedQr?.qrText || connectedQr?.pairingCode ? connectedQr : createdQr;

      return json(res, 200, {
        sucesso: true,
        message: qr?.qrDataUrl ? 'QR Code gerado. Escaneie pelo WhatsApp da barbearia.' : 'A conexao foi preparada, mas o QR Code ainda nao ficou disponivel. Tente atualizar em alguns segundos.',
        created,
        webhook,
        settings,
        connectError,
        qrcode: qr,
        webhookUrl,
        whatsapp: publicWhatsapp(whats)
      });
    }

    if (action === 'refresh-qrcode') {
      const settings = await allowCalls(whats);
      const qr = await connectInstance({
        apiUrl: whats.evolution_api_url,
        apiKey: whats.evolution_api_key,
        instanceName: whats.instance_name,
        number: safeString(body.number || loja.whatsapp_dono)
      });
      return json(res, 200, { sucesso: true, qrcode: qr, settings, whatsapp: publicWhatsapp(whats) });
    }

    if (action === 'logout') {
      let retorno = null;
      let alreadyDisconnected = false;
      try {
        retorno = await logoutInstance({
          apiUrl: whats.evolution_api_url,
          apiKey: whats.evolution_api_key,
          instanceName: whats.instance_name
        });
      } catch (err) {
        const msg = String(err.message || '').toLowerCase();
        if (msg.includes('not connected') || msg.includes('nao conectado') || msg.includes('n\u00e3o conectado')) {
          alreadyDisconnected = true;
          retorno = { aviso: 'A conexao ja estava desconectada.', detalhe: err.message };
        } else {
          throw err;
        }
      }
      await supabaseAdmin
        .from('barbearia_whatsapp')
        .update({ connected_at: null, updated_at: new Date().toISOString() })
        .eq('barbearia_id', loja.id);
      return json(res, 200, {
        sucesso: true,
        alreadyDisconnected,
        message: alreadyDisconnected ? 'WhatsApp ja estava desconectado.' : 'WhatsApp desconectado.',
        retorno,
        whatsapp: publicWhatsapp(whats)
      });
    }

    if (action === 'test') {
      const settings = await allowCalls(whats);
      const number = safeString(body.number || loja.whatsapp_dono);
      if (!number) return json(res, 400, { erro: 'Informe um numero para teste.' });
      const retorno = await sendText({
        apiUrl: whats.evolution_api_url,
        apiKey: whats.evolution_api_key,
        instanceName: whats.instance_name,
        number,
        text: `Teste do ${loja.nome}\n\nSeu WhatsApp esta conectado ao BarberOS.`
      });
      return json(res, 200, { sucesso: true, retorno, settings, whatsapp: publicWhatsapp(whats) });
    }

    return json(res, 400, { erro: 'Acao invalida.' });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
