import { normalizePhoneBR } from './http.js';

export function maskSecret(secret) {
  if (!secret) return '';
  const s = String(secret);
  if (s.length <= 8) return '********';
  return `${s.slice(0, 4)}••••••••${s.slice(-4)}`;
}

export async function sendText({ apiUrl, apiKey, instanceName, number, text }) {
  if (!apiUrl || !apiKey || !instanceName) {
    throw new Error('WhatsApp da barbearia não configurado.');
  }
  const base = String(apiUrl).replace(/\/$/, '');
  const resp = await fetch(`${base}/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey
    },
    body: JSON.stringify({
      number: normalizePhoneBR(number),
      textMessage: { text },
      delay: 600,
      linkPreview: false
    })
  });

  const raw = await resp.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }

  if (!resp.ok) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Evolution retornou erro ${resp.status}: ${msg}`);
  }
  return data;
}

export async function connectionState({ apiUrl, apiKey, instanceName }) {
  if (!apiUrl || !apiKey || !instanceName) {
    throw new Error('WhatsApp da barbearia não configurado.');
  }
  const base = String(apiUrl).replace(/\/$/, '');
  const resp = await fetch(`${base}/instance/connectionState/${encodeURIComponent(instanceName)}`, {
    method: 'GET',
    headers: { apikey: apiKey }
  });
  const raw = await resp.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  if (!resp.ok) throw new Error(typeof data === 'string' ? data : JSON.stringify(data));
  return data;
}
