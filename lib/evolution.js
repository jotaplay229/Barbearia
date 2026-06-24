import QRCode from 'qrcode';
import { normalizePhoneBR } from './http.js';

export function maskSecret(secret) {
  if (!secret) return '';
  const s = String(secret);
  if (s.length <= 8) return '********';
  return `${s.slice(0, 4)}••••••••${s.slice(-4)}`;
}

function normalizeBase(apiUrl) {
  return String(apiUrl || '').replace(/\/$/, '');
}

async function readJsonResponse(resp) {
  const raw = await resp.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = raw; }
  if (!resp.ok) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Evolution retornou erro ${resp.status}: ${msg}`);
  }
  return data;
}

export async function evolutionRequest({ apiUrl, apiKey, path, method = 'GET', body }) {
  if (!apiUrl || !apiKey) throw new Error('URL e API Key da Evolution são obrigatórios.');
  const base = normalizeBase(apiUrl);
  const resp = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return readJsonResponse(resp);
}

export async function sendText({ apiUrl, apiKey, instanceName, number, text }) {
  if (!apiUrl || !apiKey || !instanceName) {
    throw new Error('WhatsApp da barbearia não configurado.');
  }
  return evolutionRequest({
    apiUrl,
    apiKey,
    method: 'POST',
    path: `/message/sendText/${encodeURIComponent(instanceName)}`,
    body: {
      number: normalizePhoneBR(number),
      textMessage: { text },
      delay: 600,
      linkPreview: false
    }
  });
}

export async function createInstance({ apiUrl, apiKey, instanceName, webhookUrl, number }) {
  if (!apiUrl || !apiKey || !instanceName) {
    throw new Error('URL, API Key e nome da instância são obrigatórios.');
  }

  const body = {
    instanceName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
    rejectCall: true,
    msgCall: 'Olá! Esta barbearia usa este WhatsApp apenas para mensagens.',
    groupsIgnore: true,
    alwaysOnline: false,
    readMessages: false,
    readStatus: false
  };

  if (number) body.number = normalizePhoneBR(number);
  if (webhookUrl) {
    body.webhook = {
      enabled: true,
      url: webhookUrl,
      byEvents: true,
      base64: true,
      events: [
        'QRCODE_UPDATED',
        'CONNECTION_UPDATE',
        'MESSAGES_UPSERT',
        'SEND_MESSAGE'
      ]
    };
  }

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
    'qrcode',
    'base64',
    'qr',
    'code'
  ]);

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
