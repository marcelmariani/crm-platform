FROM node:20-bullseye-slim

ENV NODE_ENV=production \
        PUPPETEER_SKIP_DOWNLOAD=false \
        PUPPETEER_CACHE_DIR=/home/node/.cache/puppeteer

# Dependências do Chromium/Puppeteer
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcairo2 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libpango-1.0-0 \
        libu2f-udev \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxcomposite1 \
        libxcursor1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxrandr2 \
        libxrender1 \
        libxshmfence1 \
        libxss1 \
        libxtst6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# Instalar dependências de produção (inclui download do Chromium pelo Puppeteer)
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY . .

EXPOSE 3101

CMD ["node", "src/index.js"]
