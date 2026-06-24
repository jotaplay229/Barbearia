import { json, method } from '../lib/http.js';
import { requireOwnerBarbearia } from '../lib/auth.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const { user, barbearia } = await requireOwnerBarbearia(req);
    return json(res, 200, { user: { id: user.id, email: user.email }, barbearia });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
