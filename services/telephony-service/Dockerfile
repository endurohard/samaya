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
# Каталог кэша записей создаётся в образе и сразу с нужным владельцем: docker
# переносит права из образа в новый том, а сервис работает не от root и в чужой
# каталог писать не сможет.
RUN mkdir -p /data/recordings && chown -R node:node /data
USER node
EXPOSE 3009
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
