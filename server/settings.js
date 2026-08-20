'use strict';

const { getSupabase } = require('./supabaseClient');

const ROW_ID = 'main';

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

/* Configurações ajustáveis pelo /admin, persistidas no Supabase (tabela
   naipe_settings, uma linha só). O que estiver aqui tem prioridade sobre
   as env vars — pensado pra quem prefere configurar pela interface em
   vez de editar variável de ambiente no EasyPanel a cada mudança.

   Leituras (get/getPlans/getSubscribeDiscount) são síncronas, direto de
   um cache em memória — carregado uma vez em init() (chamado no boot do
   servidor, antes de qualquer request) e mantido atualizado a cada
   escrita. Só as escritas (setMany/setPlans/setSubscribeDiscount/clear)
   são async, porque vão até o Supabase. */
class Settings {
  constructor() {
    this.sb = getSupabase();
    this.data = {};
    if (!this.sb) console.error('[settings] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados — configurações do /admin não serão salvas.');
  }

  async init() {
    if (!this.sb) return;
    const { data, error } = await this.sb.from('naipe_settings').select('data').eq('id', ROW_ID).maybeSingle();
    if (error) { console.error('[settings] falha ao carregar:', error.message); return; }
    this.data = (data && data.data) || {};
  }

  async _save() {
    if (!this.sb) return;
    const { error } = await this.sb.from('naipe_settings').upsert({ id: ROW_ID, data: this.data });
    if (error) console.error('[settings] falha ao salvar:', error.message);
  }

  get(key, fallback) {
    const v = this.data[key];
    return v !== undefined && v !== '' ? v : fallback;
  }

  async setMany(patch) {
    Object.entries(patch).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') delete this.data[k];
      else this.data[k] = v;
    });
    await this._save();
  }

  async clear() {
    this.data = {};
    await this._save();
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

  async setPlans(patchByKey) {
    const current = this.data.plans || {};
    Object.entries(patchByKey).forEach(([key, patch]) => {
      if (!DEFAULT_PLANS[key]) return; // só os 3 planos existentes, por enquanto
      current[key] = { ...DEFAULT_PLANS[key], ...(current[key] || {}), ...patch };
    });
    this.data.plans = current;
    await this._save();
  }

  getSubscribeDiscount() {
    const v = this.data.subscribeDiscount;
    return typeof v === 'number' ? v : DEFAULT_SUBSCRIBE_DISCOUNT;
  }

  async setSubscribeDiscount(pct) {
    this.data.subscribeDiscount = pct;
    await this._save();
  }
}

module.exports = { Settings, DEFAULT_PLANS, DEFAULT_SUBSCRIBE_DISCOUNT };
