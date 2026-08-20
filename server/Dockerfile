FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
# Porta do container — o EasyPanel aponta o domínio pra ela.
ENV PORT=7789
EXPOSE 7789

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

CMD ["node", "index.js"]
