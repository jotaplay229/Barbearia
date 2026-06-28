import agendamentos from '../server/agendamentos.js';
import authLogin from '../server/auth-login.js';
import authRefresh from '../server/auth-refresh.js';
import confirmar from '../server/confirmar.js';
import config from '../server/config.js';
import cronLembretes from '../server/cron-lembretes.js';
import evolutionWebhook from '../server/evolution-webhook.js';
import horariosDisponiveis from '../server/horarios-disponiveis.js';
import ownerAgenda from '../server/owner-agenda.js';
import ownerBarbeiros from '../server/owner-barbeiros.js';
import ownerFinance from '../server/owner-finance.js';
import ownerMe from '../server/owner-me.js';
import ownerServicos from '../server/owner-servicos.js';
import ownerSettings from '../server/owner-settings.js';
import ownerWhatsapp from '../server/owner-whatsapp.js';
import publicBarbearia from '../server/public-barbearia.js';
import saasBarbearias from '../server/saas-barbearias.js';
import saasDashboard from '../server/saas-dashboard.js';
import saasOwners from '../server/saas-owners.js';

const routes = {
  'agendamentos': agendamentos,
  'auth-login': authLogin,
  'auth-refresh': authRefresh,
  'confirmar': confirmar,
  'config': config,
  'cron-lembretes': cronLembretes,
  'evolution-webhook': evolutionWebhook,
  'horarios-disponiveis': horariosDisponiveis,
  'owner-agenda': ownerAgenda,
  'owner-barbeiros': ownerBarbeiros,
  'owner-finance': ownerFinance,
  'owner-me': ownerMe,
  'owner-servicos': ownerServicos,
  'owner-settings': ownerSettings,
  'owner-whatsapp': ownerWhatsapp,
  'public-barbearia': publicBarbearia,
  'saas-barbearias': saasBarbearias,
  'saas-dashboard': saasDashboard,
  'saas-owners': saasOwners
};

export default async function handler(req, res) {
  const base = `https://${req.headers.host || 'localhost'}`;
  const url = new URL(req.url || '/', base);

  // Na Vercel Hobby usamos uma única Function para não bater o limite de 12 Functions.
  // O vercel.json reescreve /api/qualquer-rota para /api/router.js?route=qualquer-rota.
  let route = url.searchParams.get('route') || '';

  if (!route) {
    route = url.pathname
      .replace(/^\/api\//, '')
      .replace(/^router\.js\/?/, '')
      .replace(/\.js$/, '');
  }

  route = String(route).split('/')[0].replace(/\.js$/, '').trim();
  const selectedHandler = routes[route];

  if (!selectedHandler) {
    return res.status(404).json({
      erro: 'Rota de API não encontrada.',
      rota: route || null,
      exemplo: '/api/public-barbearia?slug=sua-barbearia'
    });
  }

  return selectedHandler(req, res);
}
