# Naipe Azul — API de checkout (Asaas)

Backend mínimo que recebe o formulário do `checkout.html` e cria a cobrança
(Pix ou Cartão) na Asaas. A chave de API nunca fica no navegador — só aqui,
como variável de ambiente.

## Configurar

```bash
cd server
npm install
cp .env.example .env
```

Abra o `.env` e preencha (esses valores nunca vão pro chat, edite direto no arquivo):

- `ASAAS_API_KEY` — em Integrações → API Key, dentro da conta Asaas
- `ASAAS_ENV` — `sandbox` pra testar, `production` quando for pra valer
- `ASAAS_WEBHOOK_TOKEN` — invente uma string aleatória longa (ex: `openssl rand -hex 32`)
- `ALLOWED_ORIGIN` — domínio do site em produção (ex: `https://naipeazul.com.br`)

## Rodar local

```bash
npm start          # ou: npm run dev (reinicia sozinho a cada mudança)
```

Sobe em `http://localhost:7789`. Teste com:

```bash
curl http://localhost:7789/health
```

Deve responder `{"ok":true,"asaas":true,"env":"sandbox"}` — se `asaas` vier
`false`, a `ASAAS_API_KEY` não foi lida (confira o `.env`).

O `checkout.html` já aponta pra `http://localhost:7789` quando aberto em
`localhost` — não precisa mudar nada pra testar os dois juntos localmente.

## Registrar o webhook (uma vez, depois do primeiro deploy)

A Asaas avisa este servidor quando um Pix é pago. Depois de publicar a API
num domínio público (local, com `.env`, ou direto no console do serviço no
EasyPanel, onde as env vars já estão carregadas):

```bash
node scripts/setup-webhook.js https://api.seudominio.com.br seu@email.com
```

## Deploy (Docker / EasyPanel)

Mesma lógica dos outros projetos: build a partir da pasta `server/`, defina
as variáveis de ambiente do `.env.example` no painel (nunca comite o `.env`),
e aponte o domínio da API pra porta `7789` do container.

```bash
docker build -t naipe-azul-api ./server
docker run -p 7789:7789 --env-file server/.env naipe-azul-api
```

## O que falta pra ir pra produção

- [ ] Trocar `ASAAS_ENV=sandbox` por `production` e usar a chave de produção
- [ ] Definir `ALLOWED_ORIGIN` com o domínio real (não deixar `*`)
- [ ] Registrar o webhook apontando pro domínio público da API
- [ ] Se os preços dos planos mudarem, atualizar em **dois lugares**:
      `server/index.js` (`PLANS`, quem cobra de verdade) e `checkout.html`
      (`PLANS`, só exibição)
