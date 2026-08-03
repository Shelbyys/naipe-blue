# Dockerfile na raiz porque o EasyPanel builda a partir do topo do
# repositório. O código do backend em si vive em server/ — veja
# server/README.md pra rodar/testar local sem Docker.

FROM node:22-alpine

WORKDIR /app

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/ .

RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV NODE_ENV=production
# Porta do container — o EasyPanel aponta o domínio pra ela.
ENV PORT=7789
EXPOSE 7789

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

CMD ["node", "index.js"]
