FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV APP_DB_PATH=/data/crossfolk.sqlite

COPY package.json ./
COPY public ./public
COPY server ./server
COPY migrations ./migrations

RUN mkdir -p /data && chown node:node /data

USER node

VOLUME ["/data"]

EXPOSE 3000

CMD ["node", "server/index.js"]
