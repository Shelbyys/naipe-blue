'use strict';

/* Cliente mínimo da API da Asaas — cobranças Pix e Cartão de crédito.
   A chave (ASAAS_API_KEY) fica SÓ no servidor (variável de ambiente).
   Docs: https://docs.asaas.com/  */
class Asaas {
  constructor(apiKey, env = 'sandbox') {
    this.apiKey = apiKey || '';
    this.base = env === 'production'
      ? 'https://api.asaas.com/v3'
      : 'https://sandbox.asaas.com/api/v3';
  }

  get enabled() { return !!this.apiKey; }

  async _req(method, pathname, body) {
    const res = await fetch(this.base + pathname, {
      method,
      headers: {
        'Content-Type': 'application/json',
        access_token: this.apiKey,
        'User-Agent': 'NaipeAzulCheckout',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let data;
    try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
    if (!res.ok) {
      const msg = (data.errors && data.errors[0] && data.errors[0].description) || `Asaas erro ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.asaasErrors = data.errors || null;
      throw err;
    }
    return data;
  }

  // Cria (ou reaproveita) o cliente Asaas do comprador, identificado por externalReference
  async ensureCustomer({ name, email, cpfCnpj, phone, externalReference }) {
    if (externalReference) {
      const found = await this._req('GET', `/customers?externalReference=${encodeURIComponent(externalReference)}`)
        .catch(() => null);
      if (found && Array.isArray(found.data) && found.data[0]) return found.data[0].id;
    }
    const body = { name: name || 'Cliente', externalReference };
    if (cpfCnpj) body.cpfCnpj = cpfCnpj;
    if (email) body.email = email;
    if (phone) body.mobilePhone = phone;
    const c = await this._req('POST', '/customers', body);
    return c.id;
  }

  // Cria uma cobrança Pix e já devolve o QR Code + copia-e-cola
  async createPixCharge({ customerId, value, description, externalReference, dueDate }) {
    const payment = await this._req('POST', '/payments', {
      customer: customerId,
      billingType: 'PIX',
      value,
      description,
      externalReference,
      dueDate: dueDate || new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    });
    let qr = {};
    try { qr = await this._req('GET', `/payments/${payment.id}/pixQrCode`); } catch { /* sem QR ainda */ }
    return {
      id: payment.id,
      status: payment.status,
      value: payment.value,
      invoiceUrl: payment.invoiceUrl,
      qrImage: qr.encodedImage || null, // base64 PNG
      qrPayload: qr.payload || null,    // copia-e-cola
      expiresAt: qr.expirationDate || null,
    };
  }

  // Cria uma cobrança no cartão — a Asaas processa e já devolve o resultado
  // (CONFIRMED = aprovado na hora). Os dados do cartão passam por aqui só
  // nesta chamada, direto pra Asaas — nunca são salvos em disco/log.
  async createCreditCardCharge({
    customerId, value, description, externalReference, installmentCount,
    card, holderInfo, remoteIp,
  }) {
    const body = {
      customer: customerId,
      billingType: 'CREDIT_CARD',
      value,
      description,
      externalReference,
      dueDate: new Date().toISOString().slice(0, 10),
      remoteIp,
      creditCard: {
        holderName: card.holderName,
        number: card.number,
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
        ccv: card.ccv,
      },
      creditCardHolderInfo: {
        name: holderInfo.name,
        email: holderInfo.email,
        cpfCnpj: holderInfo.cpfCnpj,
        postalCode: holderInfo.postalCode,
        addressNumber: holderInfo.addressNumber,
        phone: holderInfo.phone,
      },
    };
    if (installmentCount && installmentCount > 1) {
      body.installmentCount = installmentCount;
      body.totalValue = value;
      delete body.value;
    }
    const payment = await this._req('POST', '/payments', body);
    return {
      id: payment.id,
      status: payment.status, // CONFIRMED = aprovado, PENDING = em análise
      value: payment.value || payment.totalValue,
      invoiceUrl: payment.invoiceUrl,
    };
  }

  async getPayment(id) {
    return this._req('GET', `/payments/${id}`);
  }

  async listWebhooks() {
    const r = await this._req('GET', '/webhooks').catch(() => ({ data: [] }));
    return Array.isArray(r.data) ? r.data : [];
  }

  // Registra (ou atualiza) o webhook de pagamentos apontando para este servidor
  async setupWebhook({ url, email, authToken }) {
    const events = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE'];
    const body = {
      name: 'Naipe Azul — Checkout',
      url,
      email: email || undefined,
      enabled: true,
      interrupted: false,
      sendType: 'SEQUENTIALLY',
      authToken: authToken || undefined,
      events,
    };
    const existing = await this.listWebhooks();
    const found = existing.find((w) => w.url === url);
    if (found) {
      return this._req('PUT', `/webhooks/${found.id}`, body).then((w) => ({ ...w, updated: true }));
    }
    return this._req('POST', '/webhooks', body).then((w) => ({ ...w, created: true }));
  }
}

module.exports = { Asaas };
