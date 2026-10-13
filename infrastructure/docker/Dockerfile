# MyStream server image (backend + web client). No npm dependencies needed.
FROM node:22-alpine
ENV NODE_ENV=production APP_ENV=production MYSTREAM_HOST=0.0.0.0 MYSTREAM_PORT=8787 MYSTREAM_DATA_DIR=/data
WORKDIR /app
COPY package.json ./
COPY services/api ./services/api
COPY apps/web ./apps/web
COPY THIRD_PARTY_NOTICES.md ./
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null || exit 1
CMD ["node", "services/api/src/server.js"]
