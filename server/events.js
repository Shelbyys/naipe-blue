'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Telemetria bem simples do funil (cliques em "Começar", visitas ao
// checkout) — mesmo padrão de persistência do OrderStore, em JSON.
// Nunca guarda dado pessoal, só o tipo do evento e metadados leves
// (ex.: de qual botão veio o clique).
const VALID_TYPES = ['funnel_start', 'checkout_view'];
const MAX_EVENTS = 20000;

class EventStore {
  constructor(file) {
    this.file = file || path.join(__dirname, 'data', 'events.json');
    this.events = [];
    this._load();
  }

  _load() {
    try {
      this.events = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch { /* primeira execução, arquivo ainda não existe */ }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.events, null, 2));
    } catch (err) {
      console.error('[events] falha ao salvar:', err.message);
    }
  }

  record(type, meta) {
    if (!VALID_TYPES.includes(type)) return null;
    const ev = {
      id: crypto.randomUUID(),
      type,
      meta: meta && typeof meta === 'object' ? meta : {},
      createdAt: Date.now(),
    };
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) this.events = this.events.slice(-MAX_EVENTS);
    this._save();
    return ev;
  }

  countByType(type) {
    return this.events.filter((e) => e.type === type).length;
  }

  clear() {
    this.events = [];
    this._save();
  }
}

module.exports = { EventStore, VALID_TYPES };
