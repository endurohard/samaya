# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache tini
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM deps AS builder
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache tini
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=builder /app/dist ./dist
# Каталог для медиа (видео-превью услуг). Создаём с правами node, чтобы named volume,
# монтируемый сюда, унаследовал владельца (иначе запись под USER node → EACCES).
RUN mkdir -p /data/media/services && chown -R node:node /data
USER node
EXPOSE 3002
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
