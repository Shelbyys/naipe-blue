'use strict';

const crypto = require('node:crypto');
const { getSupabase } = require('./supabaseClient');

// Telemetria bem simples do funil (cliques em "Começar", visitas ao
// checkout), guardada no Supabase (tabela "funnel_events"). Nunca
// guarda dado pessoal, só o tipo do evento e metadados leves (ex.: de
// qual botão veio o clique).
const VALID_TYPES = ['funnel_start', 'checkout_view'];

class EventStore {
  constructor() {
    this.sb = getSupabase();
  }

  async record(type, meta) {
    if (!VALID_TYPES.includes(type) || !this.sb) return null;
    const row = {
      id: crypto.randomUUID(),
      type,
      meta: meta && typeof meta === 'object' ? meta : {},
      created_at: Date.now(),
    };
    const { error } = await this.sb.from('naipe_funnel_events').insert(row);
    if (error) { console.error('[events] falha ao salvar:', error.message); return null; }
    return row;
  }

  async countByType(type) {
    if (!this.sb) return 0;
    const { count, error } = await this.sb
      .from('naipe_funnel_events').select('*', { count: 'exact', head: true }).eq('type', type);
    if (error) { console.error('[events] falha ao contar:', error.message); return 0; }
    return count || 0;
  }

  async clear() {
    if (!this.sb) return;
    const { error } = await this.sb.from('naipe_funnel_events').delete().not('id', 'is', null);
    if (error) console.error('[events] falha ao limpar:', error.message);
  }
}

module.exports = { EventStore, VALID_TYPES };
