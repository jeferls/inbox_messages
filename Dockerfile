FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=80

WORKDIR /app

# Diretório para o banco SQLite (montado via volume)
RUN mkdir -p /data

# Instala apenas dependências em produção
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copia o restante da aplicação
COPY public ./public
COPY src ./src

EXPOSE 80

# Executa como root para garantir permissão de escrita no volume /data
CMD ["node", "src/server.js"]
