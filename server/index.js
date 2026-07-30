'use strict';

const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { Asaas } = require('./asaas');
const { OrderStore } = require('./store');

const PORT = Number(process.env.PORT) || 7789;
const ASAAS_ENV = process.env.ASAAS_ENV || 'sandbox';
const ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const asaas = new Asaas(process.env.ASAAS_API_KEY, ASAAS_ENV);
const store = new OrderStore(process.env.DATA_FILE);

// Preços definidos SÓ aqui — o valor que o navegador manda nunca é usado
// pra cobrar; só serve pra escolher qual destes planos aplicar.
// O checkout.html tem essa mesma tabela, só pra exibição — se mudar o
// preço de um plano, mude nos dois lugares.
const PLANS = {
  essencial:   { name: 'Essencial',   usos: 4,  total: 207.90 },
  confianca:   { name: 'Confiança',   usos: 12, total: 367.90 },
  performance: { name: 'Performance', usos: 24, total: 493.40 },
};
const SUBSCRIBE_DISCOUNT = 0.10;

const app = express();
app.set('trust proxy', true); // atrás do proxy do EasyPanel — pra pegar o IP real do comprador
app.use(helmet());
app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN.split(',') }));
app.use(express.json({ limit: '200kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, asaas: asaas.enabled, env: ASAAS_ENV }));

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
  const plan = PLANS[b.plan];
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

  const value = round2(plan.total * (b.subscribed ? 1 - SUBSCRIBE_DISCOUNT : 1));
  const description = `Naipe Azul — Kit ${plan.name} (${plan.usos} usos)`;

  try {
    const customerId = await asaas.ensureCustomer({ name, email, cpfCnpj: cpf, phone, externalReference: cpf });

    if (method === 'PIX') {
      const charge = await asaas.createPixCharge({
        customerId, value, description, externalReference: `${cpf}:${Date.now()}`,
      });
      store.create({
        id: charge.id, method, plan: b.plan, value, status: charge.status || 'PENDING',
        name, email, createdAt: Date.now(),
      });
      return res.json({
        ok: true, method, paymentId: charge.id, status: charge.status, value,
        qrImage: charge.qrImage, qrPayload: charge.qrPayload, invoiceUrl: charge.invoiceUrl,
      });
    }

    // CREDIT_CARD
    const card = b.card || {};
    const address = b.address || {};
    if (!card.number || !card.holderName || !card.expiryMonth || !card.expiryYear || !card.ccv) {
      return res.status(400).json({ ok: false, error: 'Dados do cartão incompletos.' });
    }
    const postalCode = onlyDigits(address.postalCode);
    const addressNumber = String(address.addressNumber || '').trim();
    if (postalCode.length !== 8 || !addressNumber) {
      return res.status(400).json({ ok: false, error: 'Informe o CEP e o número do endereço.' });
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

    store.create({
      id: charge.id, method, plan: b.plan, value, status: charge.status,
      name, email, createdAt: Date.now(),
    });
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
