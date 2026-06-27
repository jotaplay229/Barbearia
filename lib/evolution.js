import QRCode from 'qrcode';
import { normalizePhoneBR } from './http.js';

const REQUEST_TIMEOUT_MS = 25000;
const WEBHOOK_EVENTS = [
  'QRCODE_UPDATED',
  'CONNECTION_UPDATE',
  'MESSAGES_UPSERT',
  'CALL',
  'SEND_MESSAGE'
];
const CALL_REJECT_MESSAGE = 'Ol\u00e1! Esta barbearia usa este WhatsApp apenas para mensagens.';

export function maskSecret(secret) {
  if (!secret) return '';
  const s = String(secret);
  if (s.length <= 8) return '********';
  return `${s.slice(0, 4)}••••••••${s.slice(-4)}`;
}

function normalizeBase(apiUrl) {
  return String(apiUrl || '').replace(/\/+$/, '').replace(/\/manager$/i, '');
}

async function readJsonResponse(resp) {
  const raw = await resp.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = raw; }
  if (!resp.ok) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`WhatsApp retornou erro ${resp.status}: ${msg}`);
  }
  return data;
}

export async function evolutionRequest({ apiUrl, apiKey, path, method = 'GET', body }) {
  if (!apiUrl || !apiKey) throw new Error('WhatsApp ainda nao esta configurado. Fale com o suporte.');
  const base = normalizeBase(apiUrl);
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(base)) {
    throw new Error('A conexao do WhatsApp ainda esta apontando para um endereco local. Fale com o suporte para publicar a conexao.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const resp = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal
  }).catch(err => {
    if (err.name === 'AbortError') {
      throw new Error('O WhatsApp demorou para responder. Tente novamente em instantes.');
    }
    throw new Error('Nao foi possivel conectar ao WhatsApp agora. Fale com o suporte para conferir a conexao.');
  }).finally(() => clearTimeout(timeout));

  return readJsonResponse(resp);
}

export function webhookPayload(webhookUrl) {
  return {
    webhook: {
      enabled: true,
      url: webhookUrl,
      byEvents: true,
      base64: true,
      events: WEBHOOK_EVENTS
    }
  };
}

function callRejectSettings() {
  return {
    rejectCall: true,
    msgCall: CALL_REJECT_MESSAGE,
    groupsIgnore: true,
    alwaysOnline: false,
    readMessages: false,
    readStatus: false,
    syncFullHistory: false
  };
}

export async function sendText({ apiUrl, apiKey, instanceName, number, text }) {
  if (!apiUrl || !apiKey || !instanceName) {
    throw new Error('WhatsApp da barbearia não configurado.');
  }
  const path = `/message/sendText/${encodeURIComponent(instanceName)}`;
  const normalizedNumber = normalizePhoneBR(number);
  const modernBody = {
    number: normalizedNumber,
    textMessage: { text },
    delay: 600,
    linkPreview: false
  };
  const legacyBody = {
    number: normalizedNumber,
    text,
    delay: 600,
    linkPreview: false
  };

  try {
    return await evolutionRequest({ apiUrl, apiKey, method: 'POST', path, body: modernBody });
  } catch (err) {
    const msg = String(err.message || '').toLowerCase();
    if (msg.includes('property') && msg.includes('text')) {
      return evolutionRequest({ apiUrl, apiKey, method: 'POST', path, body: legacyBody });
    }
    throw err;
  }
}

export async function createInstance({ apiUrl, apiKey, instanceName, webhookUrl, number }) {
  if (!apiUrl || !apiKey || !instanceName) {
    throw new Error('WhatsApp ainda nao esta configurado. Fale com o suporte.');
  }

  const body = {
    instanceName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
    ...callRejectSettings()
  };

  if (number) body.number = normalizePhoneBR(number);
  if (webhookUrl) body.webhook = webhookPayload(webhookUrl).webhook;

  try {
    return await evolutionRequest({
      apiUrl,
      apiKey,
      method: 'POST',
      path: '/instance/create',
      body
    });
  } catch (err) {
    const msg = String(err.message || '').toLowerCase();
    // Se a instância já existe, não paramos o fluxo. Só tentamos conectar e gerar o QR.
    if (msg.includes('already') || msg.includes('exist') || msg.includes('existe') || msg.includes('duplicate')) {
      return { alreadyExists: true, message: err.message };
    }
    throw err;
  }
}

export async function setInstanceSettings({ apiUrl, apiKey, instanceName }) {
  if (!apiUrl || !apiKey || !instanceName) {
    throw new Error('WhatsApp da barbearia n\u00e3o configurado.');
  }
  return evolutionRequest({
    apiUrl,
    apiKey,
    method: 'POST',
    path: `/settings/set/${encodeURIComponent(instanceName)}`,
    body: callRejectSettings()
  });
}

export async function setWebhook({ apiUrl, apiKey, instanceName, webhookUrl }) {
  if (!webhookUrl) return null;

  try {
    return await evolutionRequest({
      apiUrl,
      apiKey,
      method: 'POST',
      path: `/webhook/set/${encodeURIComponent(instanceName)}`,
      body: webhookPayload(webhookUrl)
    });
  } catch (err) {
    const msg = String(err.message || '').toLowerCase();
    if (msg.includes('404') || msg.includes('not found')) {
      return {
        aviso: 'A conexao nao aceitou configurar o webhook separado, mas a criacao da instancia continuou.',
        erro: err.message
      };
    }
    throw err;
  }
}

function findFirstString(obj, keys = []) {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    const parts = key.split('.');
    let cur = obj;
    for (const part of parts) cur = cur?.[part];
    if (typeof cur === 'string' && cur.trim()) return cur.trim();
  }
  return '';
}

function findDeepString(obj, keys = new Set()) {
  if (!obj || typeof obj !== 'object') return '';
  for (const [key, value] of Object.entries(obj)) {
    const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');
    if (typeof value === 'string' && keys.has(normalizedKey) && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      const found = findDeepString(value, keys);
      if (found) return found;
    }
  }
  return '';
}

function looksLikeImageBase64(value) {
  const s = String(value || '').trim();
  return s.startsWith('iVBOR') || s.startsWith('/9j/') || s.startsWith('R0lGOD') || s.startsWith('PHN2Zy');
}

export async function normalizeQrPayload(payload) {
  const pairingCode = findFirstString(payload, ['pairingCode', 'qrcode.pairingCode', 'qrcode.pairing_code']);
  let qrValue = findFirstString(payload, [
    'qrcode.base64',
    'qrcode.qrcode',
    'qrcode.code',
    'qrcode.qrCode',
    'qrcode.qr_code',
    'qrcode.image',
    'instance.qrcode',
    'instance.qrCode',
    'instance.qr_code',
    'qrcode',
    'qrCode',
    'qr_code',
    'base64',
    'qr',
    'code'
  ]);

  if (!qrValue) {
    qrValue = findDeepString(payload, new Set(['qrcode', 'qrcodebase64', 'qrcodeimage', 'qrcodeurl', 'base64', 'qr', 'code', 'image']));
  }

  let qrDataUrl = '';
  let qrText = '';

  if (qrValue) {
    if (qrValue.startsWith('data:image')) {
      qrDataUrl = qrValue;
    } else if (looksLikeImageBase64(qrValue)) {
      qrDataUrl = `data:image/png;base64,${qrValue.replace(/^data:image\/\w+;base64,/, '')}`;
    } else {
      qrText = qrValue;
      qrDataUrl = await QRCode.toDataURL(qrText, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 360,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });
    }
  }

  return { qrDataUrl, qrText, pairingCode, raw: payload };
}

export async function connectInstance({ apiUrl, apiKey, instanceName, number }) {
  if (!apiUrl || !apiKey || !instanceName) {
    throw new Error('WhatsApp da barbearia não configurado.');
  }
  const q = number ? `?number=${encodeURIComponent(normalizePhoneBR(number))}` : '';
  const data = await evolutionRequest({
    apiUrl,
    apiKey,
    method: 'GET',
    path: `/instance/connect/${encodeURIComponent(instanceName)}${q}`
  });
  return normalizeQrPayload(data);
}

export async function logoutInstance({ apiUrl, apiKey, instanceName }) {
  if (!apiUrl || !apiKey || !instanceName) {
    throw new Error('WhatsApp da barbearia não configurado.');
  }
  return evolutionRequest({
    apiUrl,
    apiKey,
    method: 'DELETE',
    path: `/instance/logout/${encodeURIComponent(instanceName)}`
  });
}

export async function connectionState({ apiUrl, apiKey, instanceName }) {
  if (!apiUrl || !apiKey || !instanceName) {
    throw new Error('WhatsApp da barbearia não configurado.');
  }
  return evolutionRequest({
    apiUrl,
    apiKey,
    method: 'GET',
    path: `/instance/connectionState/${encodeURIComponent(instanceName)}`
  });
}
