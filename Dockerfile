FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && npm prune --omit=dev \
  && mkdir -p /app/data \
  && chown node:node /app/data

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DATABASE_PATH=/app/data/researchloop.sqlite

USER node

EXPOSE 8787
CMD ["npm", "run", "server:start"]
