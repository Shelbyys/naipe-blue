'use strict';

/* Roda uma vez (ou de novo se mudar de domínio) pra apontar o webhook da Asaas
   pra este servidor. Precisa do .env preenchido (ou das env vars já carregadas,
   se rodar direto no console do serviço no EasyPanel).

   Uso:
     node scripts/setup-webhook.js https://api.seudominio.com seu@email.com
*/
const { Asaas } = require('../asaas');

const baseUrl = String(process.argv[2] || '').replace(/\/+$/, '');
const email = String(process.argv[3] || '').trim();
if (!baseUrl || !email) {
  console.error('Uso: node scripts/setup-webhook.js https://api.seudominio.com seu@email.com');
  process.exit(1);
}
if (!process.env.ASAAS_WEBHOOK_TOKEN) {
  console.error('Defina ASAAS_WEBHOOK_TOKEN no .env antes de registrar o webhook.');
  process.exit(1);
}

const asaas = new Asaas(process.env.ASAAS_API_KEY, process.env.ASAAS_ENV || 'sandbox');
if (!asaas.enabled) {
  console.error('Defina ASAAS_API_KEY no .env antes de registrar o webhook.');
  process.exit(1);
}

asaas.setupWebhook({
  url: `${baseUrl}/webhooks/asaas`,
  authToken: process.env.ASAAS_WEBHOOK_TOKEN,
  email,
})
  .then((w) => console.log(`Webhook ${w.updated ? 'atualizado' : 'criado'}: ${w.url}`))
  .catch((err) => {
    console.error('Falha ao registrar o webhook:', err.message);
    process.exit(1);
  });
