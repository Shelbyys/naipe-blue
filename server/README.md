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

## Painel (/admin)

Página pra configurar tudo da Asaas sem precisar mexer nas variáveis de
ambiente do EasyPanel a cada mudança: chave de API, ambiente (sandbox/
produção), token do webhook (com botão pra gerar um novo) e a origem
permitida (CORS). Também mostra se a Asaas está conectada, lista os
pedidos recentes e registra o webhook com um clique.

O que é salvo pelo painel (`server/data/settings.json`, no mesmo volume
dos pedidos) tem **prioridade** sobre as variáveis de ambiente — pensado
pra configurar tudo por ali depois do primeiro deploy. O botão "Excluir
tudo" apaga esse arquivo e volta a usar só as env vars do servidor.

Defina `ADMIN_USER` e `ADMIN_PASSWORD` no `.env` (ou no painel do EasyPanel)
pra habilitar — sem essas duas variáveis, `/admin` fica desligado. Acesse em
`https://SEU-DOMINIO-DA-API/admin` e faça login com esse usuário/senha
(pedido pelo próprio navegador, autenticação HTTP Basic).

## Registrar o webhook (uma vez, depois do primeiro deploy)

A Asaas avisa este servidor quando um Pix é pago. O jeito mais simples é
pelo painel (`/admin`, seção "Registrar webhook") — só informar seu e-mail
e clicar no botão. Alternativa via terminal, se preferir:

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

## Já em produção

- [x] `ASAAS_ENV=production`, com a chave de produção
- [x] `ALLOWED_ORIGIN` — sem essa env var, o servidor já cai no domínio real
      do site por padrão (`DEFAULT_ALLOWED_ORIGIN` em `index.js`); nunca
      defina `*` aqui, principalmente combinado com o tracking do funil
      (`credentials: true` no CORS)
- [x] Webhook registrado (pelo botão do `/admin`)
- [x] Preço dos planos: só num lugar agora — `server/settings.js`
      (editável pelo `/admin`, seção "Planos e ofertas"). O `checkout.html`
      busca de `/api/plans` em vez de ter os valores fixos no HTML.
