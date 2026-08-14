'use strict';

const crypto = require('node:crypto');
const express = require('express');

const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function basicAuth(req, res, next) {
  if (!ADMIN_USER || !ADMIN_PASSWORD) {
    return res.status(503).send('Admin desabilitado — defina ADMIN_USER e ADMIN_PASSWORD no servidor.');
  }
  const hdr = req.headers.authorization || '';
  const encoded = hdr.startsWith('Basic ') ? hdr.slice(6) : '';
  const decoded = encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
  const sep = decoded.indexOf(':');
  const user = sep === -1 ? decoded : decoded.slice(0, sep);
  const pass = sep === -1 ? '' : decoded.slice(sep + 1);

  if (!timingSafeEqualStr(user, ADMIN_USER) || !timingSafeEqualStr(pass, ADMIN_PASSWORD)) {
    res.set('WWW-Authenticate', 'Basic realm="Naipe Azul Admin"');
    return res.status(401).send('Autenticação necessária.');
  }
  next();
}

// HTML só com marcação — nenhum <script> nem atributo onclick* aqui, pra não
// esbarrar na Content-Security-Policy do helmet (script-src 'self',
// script-src-attr 'none'). O comportamento inteiro mora em app.js,
// carregado via <script src>, que 'self' já permite.
const PAGE = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Naipe Azul — Painel</title>
<style>
  :root {
    --navy: #080F1E; --blue-dk: #0D1F3C; --blue-el: #1E90FF;
    --gold: #C9A84C; --gold-lt: #E8C97A; --green: #22C55E; --red: #EF4444;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, system-ui, sans-serif;
    background: var(--navy); color: #fff; margin: 0; padding: 24px;
  }
  main { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: rgba(255,255,255,.4); font-size: 13px; margin-bottom: 24px; }
  .card {
    background: var(--blue-dk); border: 1px solid rgba(255,255,255,.08);
    border-radius: 14px; padding: 20px; margin-bottom: 20px;
  }
  .card h2 { font-size: 15px; margin: 0 0 14px; }
  .hint { font-size: 13px; color: rgba(255,255,255,.5); margin: 0 0 14px; }
  .badge {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 20px;
  }
  .badge.on { background: rgba(34,197,94,.15); color: var(--green); }
  .badge.off { background: rgba(239,68,68,.15); color: var(--red); }
  .tag-inline { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px; margin-left: 8px; }
  .tag-inline.set { background: rgba(34,197,94,.15); color: var(--green); }
  .tag-inline.unset { background: rgba(255,255,255,.08); color: rgba(255,255,255,.4); }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; font-size: 13px; border-bottom: 1px solid rgba(255,255,255,.06); }
  .row:last-child { border-bottom: none; }
  .row span:first-child { color: rgba(255,255,255,.5); }
  .lbl {
    display: block; font-size: 12px; font-weight: 600; color: rgba(255,255,255,.5);
    margin: 14px 0 5px;
  }
  .lbl:first-of-type { margin-top: 0; }
  input, select {
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.15);
    border-radius: 8px; padding: 10px 12px; color: #fff; font-size: 14px;
    width: 100%; font-family: inherit;
  }
  select option { background: var(--blue-dk); }
  .field-row { display: flex; gap: 8px; }
  .field-row input { flex: 1; }
  .actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
  button {
    background: linear-gradient(135deg, var(--gold), var(--gold-lt));
    color: var(--navy); border: none; border-radius: 8px;
    padding: 10px 18px; font-weight: 700; font-size: 13px; cursor: pointer;
    font-family: inherit;
  }
  button:disabled { opacity: .5; cursor: default; }
  .btn-secondary { background: rgba(255,255,255,.1); color: #fff; }
  .btn-danger { background: rgba(239,68,68,.12); color: var(--red); border: 1px solid rgba(239,68,68,.3); }
  #webhookMsg, #settingsMsg, #ordersMsg { font-size: 13px; margin-top: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: rgba(255,255,255,.4); font-weight: 600; padding: 8px 6px; border-bottom: 1px solid rgba(255,255,255,.1); }
  td { padding: 8px 6px; border-bottom: 1px solid rgba(255,255,255,.06); }
  .status-tag { padding: 3px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; }
  .status-CONFIRMED, .status-RECEIVED { background: rgba(34,197,94,.15); color: var(--green); }
  .status-PENDING { background: rgba(201,168,76,.15); color: var(--gold-lt); }
  .status-OVERDUE, .status-FAILED { background: rgba(239,68,68,.15); color: var(--red); }
  .empty { color: rgba(255,255,255,.35); font-size: 13px; padding: 12px 0; }
  .card-head { display: flex; justify-content: space-between; align-items: center; }
</style>
</head>
<body>
<main>
  <h1>Naipe Azul — Painel</h1>
  <div class="sub">Status da integração de pagamento, configurações da Asaas e pedidos recentes.</div>

  <div class="card">
    <h2>Status da Asaas</h2>
    <div id="statusBox">Carregando…</div>
  </div>

  <div class="card">
    <h2>Configurações da Asaas</h2>
    <p class="hint">Deixe um campo em branco pra manter o valor atual. Salvo aqui tem prioridade sobre as variáveis de ambiente do servidor.</p>

    <label class="lbl">Chave de API <span id="apiKeyStatus" class="tag-inline"></span></label>
    <input id="cfgApiKey" type="password" placeholder="Cole aqui pra definir ou trocar a chave" autocomplete="off">

    <label class="lbl">Ambiente</label>
    <select id="cfgEnv">
      <option value="sandbox">sandbox (teste, sem dinheiro real)</option>
      <option value="production">production (cobranças reais)</option>
    </select>

    <label class="lbl">Token do webhook <span id="tokenStatus" class="tag-inline"></span></label>
    <div class="field-row">
      <input id="cfgToken" placeholder="Deixe em branco pra manter, ou gere um novo" autocomplete="off">
      <button id="genTokenBtn" type="button" class="btn-secondary">Gerar</button>
    </div>

    <label class="lbl">Origem permitida (CORS)</label>
    <input id="cfgOrigin" placeholder="https://seusite.com (ou * para qualquer um)">

    <div class="actions">
      <button id="saveSettingsBtn" type="button">Salvar configurações</button>
      <button id="clearSettingsBtn" type="button" class="btn-danger">Excluir tudo</button>
    </div>
    <div id="settingsMsg"></div>
  </div>

  <div class="card">
    <h2>Registrar webhook</h2>
    <p class="hint">
      A Asaas precisa saber pra onde avisar quando um pagamento é confirmado.
      A URL já é preenchida com o endereço deste servidor.
    </p>
    <input id="webhookUrl" readonly>
    <div style="height:10px"></div>
    <input id="webhookEmail" placeholder="Seu e-mail (obrigatório pela Asaas)">
    <div class="actions">
      <button id="webhookBtn" type="button">Registrar webhook</button>
    </div>
    <div id="webhookMsg"></div>
  </div>

  <div class="card">
    <div class="card-head">
      <h2>Pedidos recentes</h2>
      <button id="clearOrdersBtn" type="button" class="btn-danger">Limpar histórico</button>
    </div>
    <div id="ordersBox">Carregando…</div>
  </div>
</main>

<script src="/admin/app.js"></script>
</body>
</html>`;

const APP_JS = `
async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Erro ' + res.status));
  return data;
}

function fmtMoney(v) {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDate(ts) {
  return ts ? new Date(ts).toLocaleString('pt-BR') : '—';
}
function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

async function loadStatus() {
  const box = document.getElementById('statusBox');
  try {
    const s = await api('/admin/api/status');
    box.innerHTML =
      '<div class="row"><span>Conexão com a Asaas</span>' +
      '<span class="badge ' + (s.asaas ? 'on' : 'off') + '">' + (s.asaas ? '● Conectado' : '○ Desconectado') + '</span></div>' +
      '<div class="row"><span>Ambiente</span><span>' + s.env + '</span></div>' +
      '<div class="row"><span>Pedidos registrados</span><span>' + s.ordersCount + '</span></div>';
    document.getElementById('webhookUrl').value = s.webhookUrl;
  } catch (err) {
    box.innerHTML = '<div class="empty">Falha ao carregar: ' + err.message + '</div>';
  }
}

async function loadSettings() {
  try {
    const s = await api('/admin/api/settings');
    const apiKeyTag = document.getElementById('apiKeyStatus');
    apiKeyTag.textContent = s.asaasApiKeySet ? 'configurada' : 'não configurada';
    apiKeyTag.className = 'tag-inline ' + (s.asaasApiKeySet ? 'set' : 'unset');

    const tokenTag = document.getElementById('tokenStatus');
    tokenTag.textContent = s.webhookTokenSet ? 'configurado' : 'não configurado';
    tokenTag.className = 'tag-inline ' + (s.webhookTokenSet ? 'set' : 'unset');

    document.getElementById('cfgEnv').value = s.asaasEnv;
    document.getElementById('cfgOrigin').value = s.allowedOrigin === '*' ? '' : s.allowedOrigin;
  } catch (err) { /* status card já cobre o essencial */ }
}

async function loadOrders() {
  const box = document.getElementById('ordersBox');
  try {
    const { orders } = await api('/admin/api/orders');
    if (!orders.length) { box.innerHTML = '<div class="empty">Nenhum pedido ainda.</div>'; return; }
    box.innerHTML = '<table><tr><th>Data</th><th>Plano</th><th>Método</th><th>Valor</th><th>Status</th></tr>' +
      orders.map(function (o) {
        return '<tr>' +
          '<td>' + fmtDate(o.createdAt) + '</td>' +
          '<td>' + (o.plan || '—') + '</td>' +
          '<td>' + (o.method || '—') + '</td>' +
          '<td>' + fmtMoney(o.value) + '</td>' +
          '<td><span class="status-tag status-' + o.status + '">' + (o.status || '—') + '</span></td>' +
        '</tr>';
      }).join('') + '</table>';
  } catch (err) {
    box.innerHTML = '<div class="empty">Falha ao carregar: ' + err.message + '</div>';
  }
}

async function registerWebhook() {
  const btn = document.getElementById('webhookBtn');
  const msg = document.getElementById('webhookMsg');
  const email = document.getElementById('webhookEmail').value.trim();
  if (!email) { msg.textContent = 'Informe seu e-mail.'; msg.style.color = '#EF4444'; return; }
  btn.disabled = true; msg.textContent = 'Registrando…'; msg.style.color = 'rgba(255,255,255,.5)';
  try {
    const r = await api('/admin/api/webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    msg.textContent = '✓ Webhook ' + (r.updated ? 'atualizado' : 'criado') + ' com sucesso.';
    msg.style.color = '#22C55E';
  } catch (err) {
    msg.textContent = 'Falha: ' + err.message;
    msg.style.color = '#EF4444';
  } finally {
    btn.disabled = false;
  }
}

async function saveSettings() {
  const btn = document.getElementById('saveSettingsBtn');
  const msg = document.getElementById('settingsMsg');
  btn.disabled = true; msg.textContent = 'Salvando…'; msg.style.color = 'rgba(255,255,255,.5)';
  try {
    const patch = { asaasEnv: document.getElementById('cfgEnv').value };
    const apiKey = document.getElementById('cfgApiKey').value.trim();
    const token = document.getElementById('cfgToken').value.trim();
    const origin = document.getElementById('cfgOrigin').value.trim();
    if (apiKey) patch.asaasApiKey = apiKey;
    if (token) patch.asaasWebhookToken = token;
    if (origin) patch.allowedOrigin = origin;

    await api('/admin/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    msg.textContent = '✓ Configurações salvas.'; msg.style.color = '#22C55E';
    document.getElementById('cfgApiKey').value = '';
    document.getElementById('cfgToken').value = '';
    loadStatus();
    loadSettings();
  } catch (err) {
    msg.textContent = 'Falha: ' + err.message; msg.style.color = '#EF4444';
  } finally {
    btn.disabled = false;
  }
}

async function clearSettings() {
  if (!confirm('Isso apaga a chave, token e origem salvos por aqui — volta a usar só as variáveis de ambiente do servidor. Continuar?')) return;
  const msg = document.getElementById('settingsMsg');
  try {
    await api('/admin/api/settings/clear', { method: 'POST' });
    msg.textContent = '✓ Configurações removidas.'; msg.style.color = '#22C55E';
    loadStatus();
    loadSettings();
  } catch (err) {
    msg.textContent = 'Falha: ' + err.message; msg.style.color = '#EF4444';
  }
}

async function clearOrders() {
  if (!confirm('Isso apaga o histórico de pedidos salvo neste servidor (não mexe em nada na Asaas). Continuar?')) return;
  try {
    await api('/admin/api/orders/clear', { method: 'POST' });
    loadOrders();
    loadStatus();
  } catch (err) {
    alert('Falha ao limpar: ' + err.message);
  }
}

document.getElementById('webhookBtn').addEventListener('click', registerWebhook);
document.getElementById('genTokenBtn').addEventListener('click', function () {
  document.getElementById('cfgToken').value = randomToken();
});
document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
document.getElementById('clearSettingsBtn').addEventListener('click', clearSettings);
document.getElementById('clearOrdersBtn').addEventListener('click', clearOrders);

loadStatus();
loadSettings();
loadOrders();
`;

function buildAdminRouter({
  asaas, store, getAsaasEnv, getWebhookToken, getAllowedOrigin, applySettings, clearSettings,
}) {
  const router = express.Router();
  router.use(basicAuth);

  router.get('/', (_req, res) => res.type('html').send(PAGE));
  router.get('/app.js', (_req, res) => res.type('application/javascript').send(APP_JS));

  router.get('/api/status', (req, res) => {
    res.json({
      asaas: asaas.enabled,
      env: getAsaasEnv(),
      ordersCount: store.list(100000).length,
      webhookUrl: `${req.protocol}://${req.get('host')}/webhooks/asaas`,
    });
  });

  router.get('/api/settings', (_req, res) => {
    res.json({
      asaasApiKeySet: asaas.enabled,
      asaasEnv: getAsaasEnv(),
      webhookTokenSet: !!getWebhookToken(),
      allowedOrigin: getAllowedOrigin(),
    });
  });

  router.post('/api/settings', (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (typeof b.asaasApiKey === 'string' && b.asaasApiKey.trim()) patch.asaasApiKey = b.asaasApiKey.trim();
    if (b.asaasEnv === 'sandbox' || b.asaasEnv === 'production') patch.asaasEnv = b.asaasEnv;
    if (typeof b.asaasWebhookToken === 'string' && b.asaasWebhookToken.trim()) patch.asaasWebhookToken = b.asaasWebhookToken.trim();
    if (typeof b.allowedOrigin === 'string' && b.allowedOrigin.trim()) patch.allowedOrigin = b.allowedOrigin.trim();
    applySettings(patch);
    res.json({ ok: true });
  });

  router.post('/api/settings/clear', (_req, res) => {
    clearSettings();
    res.json({ ok: true });
  });

  router.get('/api/orders', (_req, res) => {
    res.json({ orders: store.list(50) });
  });

  router.post('/api/orders/clear', (_req, res) => {
    store.clear();
    res.json({ ok: true });
  });

  router.post('/api/webhook', async (req, res) => {
    const email = String((req.body || {}).email || '').trim();
    if (!email) return res.status(400).json({ error: 'Informe um e-mail.' });
    if (!asaas.enabled) return res.status(503).json({ error: 'Configure a chave de API primeiro.' });
    const webhookToken = getWebhookToken();
    if (!webhookToken) return res.status(503).json({ error: 'Defina um token de webhook primeiro (seção de configurações acima).' });

    const url = `${req.protocol}://${req.get('host')}/webhooks/asaas`;
    try {
      const w = await asaas.setupWebhook({ url, authToken: webhookToken, email });
      res.json({ ok: true, updated: !!w.updated, url: w.url });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { buildAdminRouter };
