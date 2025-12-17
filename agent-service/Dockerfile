# Dockerfile

FROM node:18

WORKDIR /usr/src/app

# Instala apenas dependências de produção
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Copia o restante da aplicação
COPY . .

# Variáveis de ambiente
ENV NODE_ENV=production

# Porta exposta pelo container
EXPOSE 3004

# Comando de inicialização
CMD ["node", "src/index.js"]
