FROM node:26-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080

# Distributor security updates + toolchain required to build the native SQLite binding.
RUN apt-get update \
 && apt-get upgrade -y \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# tsx/typescript are runtime requirements here because the API runs from TypeScript sources.
RUN npm ci --include=dev && npm cache clean --force

COPY . .
RUN npm run build

RUN mkdir -p /app/data
EXPOSE 8080

CMD ["npm", "start"]
