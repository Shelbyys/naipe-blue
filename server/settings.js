'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Planos padrão — usados até o /admin salvar algo diferente.
// monthsSupply é só pra calcular "Equivale a R$X/mês" (total / monthsSupply);
// deixe 1 (ou omita) num plano sem essa linha, como o Essencial.
const DEFAULT_PLANS = {
  essencial: {
    name: 'Essencial', usos: 4, total: 207.90,
    from: null, offPct: null, badge: null, monthsSupply: 1,
  },
  confianca: {
    name: 'Confiança', usos: 12, total: 367.90,
    from: 518.73, offPct: 32, badge: 'Mais vendido', monthsSupply: 3,
  },
  performance: {
    name: 'Performance', usos: 24, total: 493.40,
    from: 789.44, offPct: 41, badge: 'Maior economia', monthsSupply: 6,
  },
};
const DEFAULT_SUBSCRIBE_DISCOUNT = 10; // %

/* Configurações ajustáveis pelo /admin, persistidas num JSON simples
   (mesmo volume dos pedidos). O que estiver aqui tem prioridade sobre
   as env vars — pensado pra quem prefere configurar pela interface em
   vez de editar variável de ambiente no EasyPanel a cada mudança. */
class Settings {
  constructor(file) {
    this.file = file || path.join(__dirname, 'data', 'settings.json');
    this.data = {};
    this._load();
  }

  _load() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.data = {};
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('[settings] falha ao salvar:', err.message);
    }
  }

  get(key, fallback) {
    const v = this.data[key];
    return v !== undefined && v !== '' ? v : fallback;
  }

  setMany(patch) {
    Object.entries(patch).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') delete this.data[k];
      else this.data[k] = v;
    });
    this._save();
  }

  clear() {
    this.data = {};
    this._save();
  }

  // Planos: merge por chave, campo a campo, com os padrões — assim salvar
  // uma mudança num plano não perde os outros nem os campos não enviados.
  getPlans() {
    const saved = this.data.plans || {};
    const out = {};
    Object.keys(DEFAULT_PLANS).forEach((key) => {
      out[key] = { ...DEFAULT_PLANS[key], ...(saved[key] || {}) };
    });
    return out;
  }

  setPlans(patchByKey) {
    const current = this.data.plans || {};
    Object.entries(patchByKey).forEach(([key, patch]) => {
      if (!DEFAULT_PLANS[key]) return; // só os 3 planos existentes, por enquanto
      current[key] = { ...DEFAULT_PLANS[key], ...(current[key] || {}), ...patch };
    });
    this.data.plans = current;
    this._save();
  }

  getSubscribeDiscount() {
    const v = this.data.subscribeDiscount;
    return typeof v === 'number' ? v : DEFAULT_SUBSCRIBE_DISCOUNT;
  }

  setSubscribeDiscount(pct) {
    this.data.subscribeDiscount = pct;
    this._save();
  }
}

module.exports = { Settings, DEFAULT_PLANS, DEFAULT_SUBSCRIBE_DISCOUNT };
