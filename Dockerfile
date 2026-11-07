# ---- build stage: compiles the native SQLite binding and the web client ----
FROM node:22-alpine AS build

RUN apk upgrade --no-cache \
 && apk add --no-cache python3 make g++

WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev && npm cache clean --force

COPY . .
RUN npm run build

# ---- runtime stage: minimal image, no toolchain ----
FROM node:22-alpine

RUN apk upgrade --no-cache

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/tsconfig.json ./tsconfig.json

RUN mkdir -p /app/data

EXPOSE 8080
CMD ["npm", "start"]
