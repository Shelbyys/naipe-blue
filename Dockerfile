# Serve o site estático (index.html, funil.html, checkout.html etc.)
# via nginx. Este é o Dockerfile do SITE — a API de pagamento tem o
# dela própria em server/Dockerfile (serviço separado no EasyPanel,
# com Build Path = "server").

FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost/ || exit 1
