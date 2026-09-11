FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json ./
COPY public ./public
COPY server ./server

USER node

EXPOSE 3000

CMD ["node", "server/index.js"]
