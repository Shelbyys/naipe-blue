'use strict';

const { createClient } = require('@supabase/supabase-js');

// service_role key (nunca a anon) — roda só aqui no servidor, ignora
// RLS de propósito, porque orders/funnel_events não têm nenhuma policy
// pública. Sem as duas env vars configuradas, o client fica null e o
// store/events avisam no log em vez de derrubar o servidor.
let client;

function getSupabase() {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = (url && key) ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return client;
}

module.exports = { getSupabase };
