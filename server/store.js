'use strict';

const fs = require('node:fs');
const path = require('node:path');

/* Persistência simples dos pedidos, em um único arquivo JSON.
   Sem banco de dados — suficiente pro volume de um checkout como esse.
   Nunca grava dados de cartão aqui, só o resultado (aprovado/recusado). */
class OrderStore {
  constructor(file) {
    this.file = file || path.join(__dirname, 'data', 'orders.json');
    this.orders = new Map();
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const arr = JSON.parse(raw);
      arr.forEach((o) => this.orders.set(o.id, o));
    } catch { /* primeira execução, arquivo ainda não existe */ }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify([...this.orders.values()], null, 2));
    } catch (err) {
      console.error('[store] falha ao salvar pedidos:', err.message);
    }
  }

  create(order) {
    this.orders.set(order.id, order);
    this._save();
    return order;
  }

  update(id, patch) {
    const cur = this.orders.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: Date.now() };
    this.orders.set(id, next);
    this._save();
    return next;
  }

  get(id) {
    return this.orders.get(id) || null;
  }
}

module.exports = { OrderStore };
