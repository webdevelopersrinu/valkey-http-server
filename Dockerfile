FROM node:20-alpine
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js bin.js ./

ENV PORT=8080
EXPOSE 8080

# TOKEN and VALKEY_URL are provided at runtime, e.g.:
#   docker run -e TOKEN=secret -e VALKEY_URL=redis://host:6379 -p 8080:8080 valkey-http-server
CMD ["node", "bin.js"]
