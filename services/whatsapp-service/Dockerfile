FROM node:20-slim

# Install Chromium and its dependencies
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

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY src ./src
# Постоянные картинки ассистента (схемы зон липосакции ног). В образ, а не в
# volume: это часть ответа клиенту, они версионируются вместе с кодом и
# должны появиться на новом сервере сами, без ручного копирования файлов.
COPY assets ./assets

RUN mkdir -p /data/session

EXPOSE 3008

CMD ["node", "src/index.js"]
