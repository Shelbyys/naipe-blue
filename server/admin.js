'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { streamOrdersPdf } = require('./pdf');

const PAID_STATUSES = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'];

// Filtros usados tanto na listagem quanto no PDF — mesma lógica pros dois.
function filterOrders(all, q) {
  let list = all;
  if (q.method === 'PIX' || q.method === 'CREDIT_CARD') {
    list = list.filter((o) => o.method === q.method);
  }
  if (q.from) {
    const t = new Date(`${q.from}T00:00:00`).getTime();
    if (!Number.isNaN(t)) list = list.filter((o) => (o.createdAt || 0) >= t);
  }
  if (q.to) {
    const t = new Date(`${q.to}T23:59:59.999`).getTime();
    if (!Number.isNaN(t)) list = list.filter((o) => (o.createdAt || 0) <= t);
  }
  if (q.statusTab === 'paid') list = list.filter((o) => PAID_STATUSES.includes(o.status));
  if (q.statusTab === 'pending') list = list.filter((o) => !PAID_STATUSES.includes(o.status));
  return list;
}

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
  .plan-cfg { border-top: 1px solid rgba(255,255,255,.08); padding-top: 14px; margin-top: 14px; }
  .plan-cfg:first-child { border-top: none; margin-top: 0; padding-top: 0; }
  .plan-cfg h3 { font-size: 13px; font-weight: 800; color: var(--gold-lt); margin: 0 0 10px; letter-spacing: .3px; text-transform: uppercase; }
  .plan-cfg-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
  .plan-cfg-grid .f label { display: block; font-size: 11px; color: rgba(255,255,255,.4); margin-bottom: 4px; }
  .plan-cfg-grid .f input { padding: 8px 10px; font-size: 13px; }

  .order-tabs { display: flex; gap: 8px; margin-bottom: 14px; }
  .order-tab {
    background: rgba(255,255,255,.06); color: rgba(255,255,255,.6);
    border: 1px solid rgba(255,255,255,.12); border-radius: 8px;
    padding: 8px 14px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit;
  }
  .order-tab.active { background: rgba(30,144,255,.15); border-color: var(--blue-el); color: #fff; }
  .filters-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 4px; }
  .filters-grid .f label { display: block; font-size: 11px; color: rgba(255,255,255,.4); margin-bottom: 4px; }
  .filters-grid .f input, .filters-grid .f select { padding: 8px 10px; font-size: 13px; }
  .order-row { cursor: pointer; }
  .order-row:hover td { background: rgba(255,255,255,.03); }
  .order-detail-row td { background: rgba(255,255,255,.03); padding: 12px 10px; }
  .order-detail { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; font-size: 12px; color: rgba(255,255,255,.7); }
  .order-detail b { color: rgba(255,255,255,.9); font-weight: 700; }
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
    <h2>Planos e ofertas</h2>
    <p class="hint">
      Preço "De" e "% OFF" em branco fazem a tarja riscada e o selo de desconto não aparecerem
      no checkout. "Meses de estoque" só serve pra calcular a linha "Equivale a R$/mês".
    </p>

    <label class="lbl">Desconto por assinatura (%)</label>
    <input id="cfgSubscribeDiscount" type="number" min="0" max="90" placeholder="10">

    <div id="plansCfgBox" style="margin-top:14px">Carregando…</div>

    <div class="actions">
      <button id="savePlansBtn" type="button">Salvar planos</button>
    </div>
    <div id="plansMsg"></div>
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
      <h2>Pedidos</h2>
      <button id="clearOrdersBtn" type="button" class="btn-danger">Limpar histórico</button>
    </div>

    <div class="order-tabs">
      <button class="order-tab active" data-status-tab="all" type="button">Todos</button>
      <button class="order-tab" data-status-tab="pending" type="button">Pendentes</button>
      <button class="order-tab" data-status-tab="paid" type="button">Pagos</button>
    </div>

    <div class="filters-grid">
      <div class="f">
        <label>Método</label>
        <select id="filterMethod">
          <option value="">Todos</option>
          <option value="PIX">Pix</option>
          <option value="CREDIT_CARD">Cartão</option>
        </select>
      </div>
      <div class="f"><label>De</label><input id="filterFrom" type="date"></div>
      <div class="f"><label>Até</label><input id="filterTo" type="date"></div>
    </div>

    <div class="actions">
      <button id="genPdfBtn" type="button" class="btn-secondary">📄 Gerar PDF</button>
    </div>

    <p class="hint" style="margin-top:10px">Clique num pedido pra ver todos os dados (e-mail, telefone, CPF, endereço).</p>
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

const PLAN_KEYS = ['essencial', 'confianca', 'performance'];
const PLAN_HEADS = { essencial: 'Essencial', confianca: 'Confiança', performance: 'Performance' };

function planField(key, attr, label, value, type) {
  const id = 'plan_' + key + '_' + attr;
  const v = value === null || value === undefined ? '' : value;
  const escaped = String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return '<div class="f"><label>' + label + '</label><input id="' + id + '" type="' + type + '" value="' + escaped + '"></div>';
}

async function loadPlansConfig() {
  const box = document.getElementById('plansCfgBox');
  try {
    const { plans, subscribeDiscountPct } = await api('/admin/api/plans');
    document.getElementById('cfgSubscribeDiscount').value = subscribeDiscountPct;
    box.innerHTML = PLAN_KEYS.map(function (key) {
      const p = plans[key] || {};
      return '<div class="plan-cfg"><h3>' + PLAN_HEADS[key] + '</h3><div class="plan-cfg-grid">' +
        planField(key, 'name', 'Nome', p.name, 'text') +
        planField(key, 'usos', 'Usos', p.usos, 'number') +
        planField(key, 'total', 'Preço atual (R$)', p.total, 'number') +
        planField(key, 'from', 'Preço "De" (R$, opcional)', p.from, 'number') +
        planField(key, 'offPct', '% OFF (opcional)', p.offPct, 'number') +
        planField(key, 'badge', 'Selo (opcional)', p.badge, 'text') +
        planField(key, 'monthsSupply', 'Meses de estoque', p.monthsSupply, 'number') +
        '</div></div>';
    }).join('');
  } catch (err) {
    box.innerHTML = '<div class="empty">Falha ao carregar: ' + err.message + '</div>';
  }
}

async function savePlans() {
  const btn = document.getElementById('savePlansBtn');
  const msg = document.getElementById('plansMsg');
  btn.disabled = true; msg.textContent = 'Salvando…'; msg.style.color = 'rgba(255,255,255,.5)';
  try {
    const plansPatch = {};
    PLAN_KEYS.forEach(function (key) {
      const val = function (attr) { return document.getElementById('plan_' + key + '_' + attr).value.trim(); };
      plansPatch[key] = {
        name: val('name'),
        usos: Number(val('usos')) || 0,
        total: Number(val('total')) || 0,
        from: val('from') === '' ? null : Number(val('from')),
        offPct: val('offPct') === '' ? null : Number(val('offPct')),
        badge: val('badge') || null,
        monthsSupply: Number(val('monthsSupply')) || 1,
      };
    });
    const subscribeDiscountPct = Number(document.getElementById('cfgSubscribeDiscount').value) || 0;

    await api('/admin/api/plans', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plans: plansPatch, subscribeDiscountPct }),
    });
    msg.textContent = '✓ Planos salvos.'; msg.style.color = '#22C55E';
  } catch (err) {
    msg.textContent = 'Falha: ' + err.message; msg.style.color = '#EF4444';
  } finally {
    btn.disabled = false;
  }
}

let activeStatusTab = 'all';
let ordersCache = [];

function clientStatusLabel(s) {
  const map = {
    PENDING: 'Aguardando', CONFIRMED: 'Pago', RECEIVED: 'Pago',
    RECEIVED_IN_CASH: 'Pago', OVERDUE: 'Vencido', REFUNDED: 'Estornado',
  };
  return map[s] || s || '—';
}

function currentFilterParams() {
  const params = new URLSearchParams();
  const method = document.getElementById('filterMethod').value;
  const from = document.getElementById('filterFrom').value;
  const to = document.getElementById('filterTo').value;
  if (method) params.set('method', method);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (activeStatusTab !== 'all') params.set('statusTab', activeStatusTab);
  return params;
}

function orderDetailHtml(o) {
  const addr = o.address || {};
  const line1 = [addr.street, addr.addressNumber, addr.complement].filter(Boolean).join(', ');
  const line2 = [addr.neighborhood, [addr.city, addr.state].filter(Boolean).join('/')].filter(Boolean).join(' — ');
  const addrFull = [line1, line2, addr.postalCode ? 'CEP ' + addr.postalCode : ''].filter(Boolean).join(' — ') || '—';
  return '<div class="order-detail">' +
    '<div><b>E-mail:</b> ' + (o.email || '—') + '</div>' +
    '<div><b>Telefone:</b> ' + (o.phone || '—') + '</div>' +
    '<div><b>CPF:</b> ' + (o.cpf || '—') + '</div>' +
    '<div><b>ID do pagamento:</b> ' + (o.id || '—') + '</div>' +
    '<div style="grid-column:1/-1"><b>Endereço:</b> ' + addrFull + '</div>' +
    '<div><b>Assinatura:</b> ' + (o.subscribed ? 'Sim' : 'Não') + '</div>' +
    (o.installments > 1 ? '<div><b>Parcelas:</b> ' + o.installments + 'x</div>' : '') +
    '</div>';
}

function renderOrdersTable() {
  const box = document.getElementById('ordersBox');
  if (!ordersCache.length) { box.innerHTML = '<div class="empty">Nenhum pedido encontrado.</div>'; return; }
  box.innerHTML = '<table><tr><th>Data</th><th>Cliente</th><th>Plano</th><th>Método</th><th>Valor</th><th>Status</th></tr>' +
    ordersCache.map(function (o, i) {
      return (
        '<tr class="order-row" data-idx="' + i + '">' +
          '<td>' + fmtDate(o.createdAt) + '</td>' +
          '<td>' + (o.name || '—') + '</td>' +
          '<td>' + (o.planName || o.plan || '—') + '</td>' +
          '<td>' + (o.method === 'PIX' ? 'Pix' : 'Cartão') + '</td>' +
          '<td>' + fmtMoney(o.value) + '</td>' +
          '<td><span class="status-tag status-' + o.status + '">' + clientStatusLabel(o.status) + '</span></td>' +
        '</tr>' +
        '<tr class="order-detail-row" id="detail-' + i + '" hidden><td colspan="6">' + orderDetailHtml(o) + '</td></tr>'
      );
    }).join('') + '</table>';

  document.querySelectorAll('.order-row').forEach(function (row) {
    row.addEventListener('click', function () {
      const detail = document.getElementById('detail-' + row.dataset.idx);
      detail.hidden = !detail.hidden;
    });
  });
}

async function loadOrders() {
  const box = document.getElementById('ordersBox');
  try {
    const { orders } = await api('/admin/api/orders?' + currentFilterParams().toString());
    ordersCache = orders;
    renderOrdersTable();
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
document.getElementById('savePlansBtn').addEventListener('click', savePlans);

document.querySelectorAll('.order-tab').forEach(function (tab) {
  tab.addEventListener('click', function () {
    document.querySelectorAll('.order-tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    activeStatusTab = tab.dataset.statusTab;
    loadOrders();
  });
});
document.getElementById('filterMethod').addEventListener('change', loadOrders);
document.getElementById('filterFrom').addEventListener('change', loadOrders);
document.getElementById('filterTo').addEventListener('change', loadOrders);
document.getElementById('genPdfBtn').addEventListener('click', function () {
  window.location.href = '/admin/api/orders/pdf?' + currentFilterParams().toString();
});

loadStatus();
loadSettings();
loadPlansConfig();
loadOrders();
`;

function buildAdminRouter({
  asaas, store, getAsaasEnv, getWebhookToken, getAllowedOrigin, applySettings, clearSettings,
  getPlans, setPlans, getSubscribeDiscountPct, setSubscribeDiscountPct,
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

  router.get('/api/plans', (_req, res) => {
    res.json({ plans: getPlans(), subscribeDiscountPct: getSubscribeDiscountPct() });
  });

  router.post('/api/plans', (req, res) => {
    const b = req.body || {};
    const PLAN_KEYS = ['essencial', 'confianca', 'performance'];
    const patch = {};
    PLAN_KEYS.forEach((key) => {
      const p = (b.plans || {})[key];
      if (!p || typeof p !== 'object') return;
      patch[key] = {
        name: String(p.name || '').trim() || undefined,
        usos: Number(p.usos) || undefined,
        total: Number(p.total) || undefined,
        from: p.from === null || p.from === undefined || p.from === '' ? null : Number(p.from),
        offPct: p.offPct === null || p.offPct === undefined || p.offPct === '' ? null : Number(p.offPct),
        badge: p.badge ? String(p.badge).trim() : null,
        monthsSupply: Number(p.monthsSupply) || undefined,
      };
      Object.keys(patch[key]).forEach((k) => { if (patch[key][k] === undefined) delete patch[key][k]; });
    });
    setPlans(patch);
    if (typeof b.subscribeDiscountPct === 'number') setSubscribeDiscountPct(b.subscribeDiscountPct);
    res.json({ ok: true });
  });

  router.get('/api/orders', (req, res) => {
    res.json({ orders: filterOrders(store.list(100000), req.query) });
  });

  router.get('/api/orders/pdf', (req, res) => {
    const orders = filterOrders(store.list(100000), req.query);
    const parts = [];
    if (req.query.method) parts.push('Método: ' + (req.query.method === 'PIX' ? 'Pix' : 'Cartão'));
    if (req.query.from) parts.push('De: ' + req.query.from);
    if (req.query.to) parts.push('Até: ' + req.query.to);
    if (req.query.statusTab === 'paid') parts.push('Somente pagos');
    if (req.query.statusTab === 'pending') parts.push('Somente pendentes');
    streamOrdersPdf(res, orders, parts.join(' · ') || 'nenhum');
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
