# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY shared ./shared
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS runtime-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
ENV NODE_ENV=production
ENV PORT=5174
ENV CONFIG_IMPORT_FILE=/data/import-config.json
ENV DB_CONNECTION_FILE=/data/postgres-connection.json
ENV DB_PASSWORD_FILE=/data/postgres-connection-password
ENV HASS_URL_FILE=/data/hass-url.txt
WORKDIR /app

COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 5174
CMD ["node", "server/index.mjs"]
