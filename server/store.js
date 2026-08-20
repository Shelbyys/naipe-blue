'use strict';

const { getSupabase } = require('./supabaseClient');

/* Persistência dos pedidos no Supabase (tabela "orders", veja
   supabase-schema.sql). Nunca grava dado de cartão aqui, só o
   resultado (aprovado/recusado). Mesma interface de antes (quando isso
   era um arquivo JSON local) pra não precisar mexer em quem chama. */

function toRow(o) {
  const row = {};
  if (o.id !== undefined) row.id = o.id;
  if (o.method !== undefined) row.method = o.method;
  if (o.plan !== undefined) row.plan = o.plan;
  if (o.planName !== undefined) row.plan_name = o.planName;
  if (o.value !== undefined) row.value = o.value;
  if (o.subscribed !== undefined) row.subscribed = o.subscribed;
  if (o.name !== undefined) row.name = o.name;
  if (o.email !== undefined) row.email = o.email;
  if (o.cpf !== undefined) row.cpf = o.cpf;
  if (o.phone !== undefined) row.phone = o.phone;
  if (o.address !== undefined) row.address = o.address;
  if (o.status !== undefined) row.status = o.status;
  if (o.installments !== undefined) row.installments = o.installments;
  if (o.createdAt !== undefined) row.created_at = o.createdAt;
  if (o.updatedAt !== undefined) row.updated_at = o.updatedAt;
  return row;
}

function fromRow(r) {
  return {
    id: r.id, method: r.method, plan: r.plan, planName: r.plan_name, value: Number(r.value),
    subscribed: r.subscribed, name: r.name, email: r.email, cpf: r.cpf, phone: r.phone,
    address: r.address || {}, status: r.status, installments: r.installments,
    createdAt: Number(r.created_at), updatedAt: r.updated_at ? Number(r.updated_at) : undefined,
  };
}

class OrderStore {
  constructor() {
    this.sb = getSupabase();
    if (!this.sb) console.error('[store] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados — pedidos não serão salvos.');
  }

  async create(order) {
    if (!this.sb) return order;
    const { error } = await this.sb.from('naipe_orders').upsert(toRow(order));
    if (error) console.error('[store] falha ao criar pedido:', error.message);
    return order;
  }

  async update(id, patch) {
    if (!this.sb) return null;
    const row = toRow({ ...patch, updatedAt: Date.now() });
    const { data, error } = await this.sb.from('naipe_orders').update(row).eq('id', id).select().maybeSingle();
    if (error) { console.error('[store] falha ao atualizar pedido:', error.message); return null; }
    return data ? fromRow(data) : null;
  }

  async get(id) {
    if (!this.sb) return null;
    const { data, error } = await this.sb.from('naipe_orders').select('*').eq('id', id).maybeSingle();
    if (error) { console.error('[store] falha ao buscar pedido:', error.message); return null; }
    return data ? fromRow(data) : null;
  }

  // Mais recentes primeiro
  async list(limit = 50) {
    if (!this.sb) return [];
    const { data, error } = await this.sb
      .from('naipe_orders').select('*').order('created_at', { ascending: false }).limit(limit);
    if (error) { console.error('[store] falha ao listar pedidos:', error.message); return []; }
    return (data || []).map(fromRow);
  }

  async clear() {
    if (!this.sb) return;
    const { error } = await this.sb.from('naipe_orders').delete().not('id', 'is', null);
    if (error) console.error('[store] falha ao limpar pedidos:', error.message);
  }
}

module.exports = { OrderStore };
