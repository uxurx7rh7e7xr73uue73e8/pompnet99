FROM node:26-alpine
RUN apk upgrade --no-cache
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=8080
EXPOSE 8080
# IMPORTANT: your server MUST listen on 0.0.0.0 and process.env.PORT.
CMD ["npm","start"]
