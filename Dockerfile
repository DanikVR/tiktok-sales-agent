FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
COPY locales/ ../locales/
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache ffmpeg python3 py3-pip && pip3 install --break-system-packages yt-dlp curl_cffi
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci
COPY server/ ./server/
COPY sql/ ./sql/
COPY locales/ ./locales/
COPY public/ ./public/
COPY --from=web /app/web/dist ./web/dist
RUN cd server && npm run build
ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["node", "server/dist/server.js"]
