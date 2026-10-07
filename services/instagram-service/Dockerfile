FROM node:20-slim

# Chromium и его зависимости. Ставим системный, а не скачанный puppeteer'ом:
# образ меньше, а версия обновляется вместе с базовым слоем. Поэтому в
# зависимостях puppeteer-core, и require('puppeteer') здесь упадёт.
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
# Часовой пояс контейнера как у клиники: расхождение локали браузера с
# регионом аккаунта — лишний сигнал автоматизации для Instagram.
ENV TZ=Europe/Moscow

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY src ./src

RUN mkdir -p /data/session /data/media

EXPOSE 3010

CMD ["node", "src/index.js"]
