import path from 'node:path';
import express from 'express';
import { strings, formatString } from '../shared/strings.js';
import { config as loadConfig } from './config.js';
import { MarkdownFilesystem } from './filesystem/markdown-filesystem.js';
import { WatcherService } from './watcher/service.js';
import { createApp } from './http.js';

const config = loadConfig();
const filesystem = await MarkdownFilesystem.create(config.root, config.maxBytes);
const watcher = new WatcherService(filesystem, config.polling, config.pollInterval);
await watcher.start();
const app = createApp(config, filesystem, watcher);
const production = process.env.NODE_ENV === 'production' || import.meta.url.includes('/dist/');
let closeVite: (() => Promise<void>) | undefined;
if (production) {
  const client = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../client');
  app.use((_request, response, next) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    next();
  });
  app.use(express.static(client));
  app.get(['/', '/editor'], (_request, response) => { response.sendFile(path.join(client, 'index.html')); });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
  closeVite = () => vite.close();
}
const server = app.listen(config.port, config.host, () => {
  console.info(formatString(strings.server.listening, { url: `http://${config.host}:${config.port}`, authMode: config.authMode }));
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close(); server.closeAllConnections();
  await closeVite?.(); await watcher.close(); await filesystem.close();
}
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
