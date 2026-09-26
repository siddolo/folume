FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 MARKDOWN_ROOT=/data/notes
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir -p /data/notes && chown node:node /data/notes
COPY --from=build /app/dist ./dist
COPY --chown=node:node notes /data/notes
USER node
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
