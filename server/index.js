'use strict';

const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { Asaas } = require('./asaas');
const { OrderStore } = require('./store');
const { EventStore, VALID_TYPES } = require('./events');
const { Settings } = require('./settings');
const { buildAdminRouter } = require('./admin');

const PORT = Number(process.env.PORT) || 7789;

const settings = new Settings(process.env.SETTINGS_FILE);
const store = new OrderStore(process.env.DATA_FILE);
const events = new EventStore(process.env.EVENTS_FILE);

// O que estiver salvo pelo /admin (settings.json) tem prioridade sobre a
// env var — pensado pra configurar tudo pela interface, sem redeploy.
// São "let" de propósito: o /admin muda esses valores em tempo real.
let ASAAS_ENV = settings.get('asaasEnv', process.env.ASAAS_ENV || 'sandbox');
let ASAAS_WEBHOOK_TOKEN = settings.get('asaasWebhookToken', process.env.ASAAS_WEBHOOK_TOKEN || '');
let ALLOWED_ORIGIN = settings.get('allowedOrigin', process.env.ALLOWED_ORIGIN || '*');

const asaas = new Asaas(settings.get('asaasApiKey', process.env.ASAAS_API_KEY), ASAAS_ENV);

// Aplica uma mudança feita pelo /admin (chamado pelo admin.js)
function applySettings(patch) {
  settings.setMany(patch);
  if (patch.asaasApiKey !== undefined) {
    asaas.apiKey = settings.get('asaasApiKey', process.env.ASAAS_API_KEY || '');
  }
  if (patch.asaasEnv !== undefined) {
    ASAAS_ENV = settings.get('asaasEnv', process.env.ASAAS_ENV || 'sandbox');
    asaas.base = ASAAS_ENV === 'production'
      ? 'https://api.asaas.com/v3'
      : 'https://sandbox.asaas.com/api/v3';
  }
  if (patch.asaasWebhookToken !== undefined) {
    ASAAS_WEBHOOK_TOKEN = settings.get('asaasWebhookToken', process.env.ASAAS_WEBHOOK_TOKEN || '');
  }
  if (patch.allowedOrigin !== undefined) {
    ALLOWED_ORIGIN = settings.get('allowedOrigin', process.env.ALLOWED_ORIGIN || '*');
  }
}

function clearSettings() {
  settings.clear();
  asaas.apiKey = process.env.ASAAS_API_KEY || '';
  ASAAS_ENV = process.env.ASAAS_ENV || 'sandbox';
  asaas.base = ASAAS_ENV === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3';
  ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || '';
  ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
}

// Planos: vêm do settings.js (editáveis pelo /admin, com os padrões como
// base). O valor que o navegador manda no checkout NUNCA é usado pra
// cobrar — só escolhe qual destes planos aplicar; o preço de verdade
// é sempre lido daqui, no momento da cobrança.
function getPlans() { return settings.getPlans(); }
function getSubscribeDiscountPct() { return settings.getSubscribeDiscount(); }

const app = express();
app.set('trust proxy', true); // atrás do proxy do EasyPanel — pra pegar o IP real do comprador
app.use(helmet());
// Função (não valor fixo) porque ALLOWED_ORIGIN pode mudar em tempo real via /admin
app.use(cors({
  origin: (origin, cb) => {
    if (ALLOWED_ORIGIN === '*') return cb(null, true);
    const allowed = ALLOWED_ORIGIN.split(',').map((s) => s.trim());
    cb(null, !origin || allowed.includes(origin));
  },
  // navigator.sendBeacon (usado no tracking do funil) sempre manda a
  // requisição com credentials:'include' — sem isso o navegador bloqueia
  // a resposta do preflight mesmo sem nenhum cookie estar de fato em jogo.
  credentials: true,
}));
app.use(express.json({ limit: '200kb' }));

app.get('/', (_req, res) => res.json({
  service: 'Naipe Azul — API de pagamento',
  info: 'Este serviço não é o site. É só o backend que o checkout.html chama pra criar cobranças na Asaas.',
  health: '/health',
}));
app.get('/health', (_req, res) => res.json({ ok: true, asaas: asaas.enabled, env: ASAAS_ENV }));

// Público (sem auth) — o checkout.html busca os planos aqui em vez de ter
// os preços fixados no HTML, pra nunca ficar dessincronizado do que cobra.
app.get('/api/plans', (_req, res) => {
  res.json({ plans: getPlans(), subscribeDiscountPct: getSubscribeDiscountPct() });
});

// Telemetria leve do funil (cliques em "Começar", visitas ao checkout) —
// público e best-effort: nunca deve travar a navegação do usuário nem
// vazar erro pro front, então sempre responde 200.
app.post('/api/events', (req, res) => {
  const { type, meta } = req.body || {};
  if (VALID_TYPES.includes(type)) events.record(type, meta);
  res.json({ ok: true });
});

app.use('/admin', buildAdminRouter({
  asaas,
  store,
  events,
  settings,
  getAsaasEnv: () => ASAAS_ENV,
  getWebhookToken: () => ASAAS_WEBHOOK_TOKEN,
  getAllowedOrigin: () => ALLOWED_ORIGIN,
  applySettings,
  clearSettings,
  getPlans,
  setPlans: (patch) => settings.setPlans(patch),
  getSubscribeDiscountPct,
  setSubscribeDiscountPct: (pct) => settings.setSubscribeDiscount(pct),
}));

// ---------- limite simples de tentativas por IP (a rota mexe com pagamento de verdade) ----------
const attempts = new Map(); // ip -> [timestamps]
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 8;
function rateLimited(ip) {
  const now = Date.now();
  const hist = (attempts.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  hist.push(now);
  attempts.set(ip, hist);
  return hist.length > RATE_MAX;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, hist] of attempts) {
    const fresh = hist.filter((t) => now - t < RATE_WINDOW_MS);
    if (fresh.length) attempts.set(ip, fresh); else attempts.delete(ip);
  }
}, 5 * 60 * 1000).unref();

function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }

function round2(n) { return Math.round(n * 100) / 100; }

// ---------- checkout ----------
app.post('/api/checkout', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || '';
  if (rateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
  }
  if (!asaas.enabled) {
    return res.status(503).json({ ok: false, error: 'Pagamentos ainda não configurados no servidor.' });
  }

  const b = req.body || {};
  const plan = getPlans()[b.plan];
  if (!plan) return res.status(400).json({ ok: false, error: 'Plano inválido.' });

  const method = b.paymentMethod === 'CREDIT_CARD' ? 'CREDIT_CARD' : b.paymentMethod === 'PIX' ? 'PIX' : null;
  if (!method) return res.status(400).json({ ok: false, error: 'Forma de pagamento inválida.' });

  const customer = b.customer || {};
  const name  = String(customer.name || '').trim();
  const email = String(customer.email || '').trim();
  const cpf   = onlyDigits(customer.cpf);
  const phone = onlyDigits(customer.phone);
  if (!name || name.length < 3) return res.status(400).json({ ok: false, error: 'Informe o nome completo.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: 'E-mail inválido.' });
  if (cpf.length !== 11) return res.status(400).json({ ok: false, error: 'CPF inválido.' });
  if (phone.length < 10) return res.status(400).json({ ok: false, error: 'WhatsApp inválido.' });

  const addr = b.address || {};
  const postalCode = onlyDigits(addr.postalCode);
  const addressNumber = String(addr.addressNumber || '').trim();
  if (postalCode.length !== 8 || !addressNumber) {
    return res.status(400).json({ ok: false, error: 'Informe o CEP e o número do endereço.' });
  }
  const address = {
    postalCode, addressNumber,
    street: String(addr.street || '').trim(),
    complement: String(addr.complement || '').trim(),
    neighborhood: String(addr.neighborhood || '').trim(),
    city: String(addr.city || '').trim(),
    state: String(addr.state || '').trim(),
  };

  const value = round2(plan.total * (b.subscribed ? 1 - getSubscribeDiscountPct() / 100 : 1));
  const description = `Naipe Azul — Kit ${plan.name} (${plan.usos} usos)`;

  // Dados comuns do pedido, salvos independente da forma de pagamento —
  // nunca inclui número de cartão/CVV, esses só passam pra Asaas.
  const orderBase = {
    method, plan: b.plan, planName: plan.name, value, subscribed: !!b.subscribed,
    name, email, cpf, phone, address, createdAt: Date.now(),
  };

  try {
    const customerId = await asaas.ensureCustomer({ name, email, cpfCnpj: cpf, phone, externalReference: cpf });

    if (method === 'PIX') {
      const charge = await asaas.createPixCharge({
        customerId, value, description, externalReference: `${cpf}:${Date.now()}`,
      });
      store.create({ ...orderBase, id: charge.id, status: charge.status || 'PENDING' });
      return res.json({
        ok: true, method, paymentId: charge.id, status: charge.status, value,
        qrImage: charge.qrImage, qrPayload: charge.qrPayload, invoiceUrl: charge.invoiceUrl,
      });
    }

    // CREDIT_CARD
    const card = b.card || {};
    if (!card.number || !card.holderName || !card.expiryMonth || !card.expiryYear || !card.ccv) {
      return res.status(400).json({ ok: false, error: 'Dados do cartão incompletos.' });
    }

    const installments = Math.min(Math.max(parseInt(b.installments, 10) || 1, 1), 12);
    const charge = await asaas.createCreditCardCharge({
      customerId, value, description, externalReference: `${cpf}:${Date.now()}`,
      installmentCount: installments,
      card: {
        holderName: card.holderName,
        number: onlyDigits(card.number),
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
        ccv: card.ccv,
      },
      holderInfo: { name, email, cpfCnpj: cpf, postalCode, addressNumber, phone },
      remoteIp: ip,
    });

    store.create({ ...orderBase, id: charge.id, status: charge.status, installments });
    return res.json({ ok: true, method, paymentId: charge.id, status: charge.status, value });
  } catch (err) {
    console.error('[checkout] erro:', err.message);
    return res.status(err.status && err.status < 500 ? 400 : 502).json({
      ok: false,
      error: err.message || 'Falha ao processar o pagamento. Tente novamente.',
    });
  }
});

// Pro front-end consultar se o Pix já caiu (fallback caso o webhook atrase)
app.get('/api/orders/:id', async (req, res) => {
  const order = store.get(req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });

  // Confere direto na Asaas também — não depende só do webhook já ter chegado
  if (order.status !== 'CONFIRMED' && order.status !== 'RECEIVED' && asaas.enabled) {
    try {
      const info = await asaas.getPayment(order.id);
      if (info.status !== order.status) store.update(order.id, { status: info.status });
      return res.json({ ok: true, id: order.id, status: info.status, value: order.value, plan: order.plan });
    } catch { /* segue com o status que já temos salvo */ }
  }
  res.json({ ok: true, id: order.id, status: order.status, value: order.value, plan: order.plan });
});

// Webhook da Asaas: confirma pagamentos (Pix e cartão pendente de análise).
// FALHA FECHADO: sem ASAAS_WEBHOOK_TOKEN configurado, nenhuma chamada é aceita.
app.post('/webhooks/asaas', (req, res) => {
  const given = Buffer.from(String(req.headers['asaas-access-token'] || ''));
  const expected = Buffer.from(ASAAS_WEBHOOK_TOKEN || '');
  const tokenOk = ASAAS_WEBHOOK_TOKEN
    && given.length === expected.length
    && crypto.timingSafeEqual(given, expected);
  if (!tokenOk) {
    if (!ASAAS_WEBHOOK_TOKEN) console.error('[webhook] chamado sem ASAAS_WEBHOOK_TOKEN configurado — recusado.');
    return res.status(401).json({ error: 'token inválido' });
  }
  try {
    const ev = req.body || {};
    const pay = ev.payment || {};
    if (pay.id) store.update(pay.id, { status: pay.status });
  } catch (err) {
    console.error('[webhook] erro:', err.message);
  }
  res.json({ ok: true }); // sempre 200 pra Asaas não reenviar em loop
});

app.listen(PORT, () => {
  console.log(`Naipe Azul API rodando na porta ${PORT}`);
  console.log(`Asaas: ${asaas.enabled ? `ativo (${ASAAS_ENV})` : 'DESLIGADO (defina ASAAS_API_KEY)'}`);
});
