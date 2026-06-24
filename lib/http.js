export function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function json(res, status, payload) {
  setCors(res);
  return res.status(status).json(payload);
}

export function method(req, res, allowed = []) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  if (!allowed.includes(req.method)) {
    json(res, 405, { erro: 'Método não permitido.' });
    return false;
  }
  return true;
}

export function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.replace('Bearer ', '').trim();
}

export function safeString(value, fallback = '') {
  return String(value ?? fallback).trim();
}

export function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function normalizePhoneBR(value) {
  let n = onlyDigits(value);
  if (!n) return '';
  if (!n.startsWith('55')) n = '55' + n;
  return n;
}

export function publicBaseUrl() {
  return process.env.APP_URL || process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}` || '';
}
