import express, { type ErrorRequestHandler } from 'express';
import { strings, formatString } from '../shared/strings.js';
import type { Config } from './config.js';
import { authenticate, protectMutations } from './auth.js';
import type { MarkdownFilesystem } from './filesystem/markdown-filesystem.js';
import { FsError, publicError } from './filesystem/errors.js';
import type { WatcherService } from './watcher/service.js';

export function createApp(config: Config, filesystem: MarkdownFilesystem, watcher: WatcherService) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(authenticate(config));
  app.use('/api', protectMutations(config), express.json({ limit: config.maxBytes * 6 + 4096 }));
  app.get('/api/files/tree', async (_request, response) => { response.json(await filesystem.tree()); });
  app.get('/api/files/content', async (request, response) => { response.json(await filesystem.read(request.query.path as string)); });
  app.put('/api/files/content', async (request, response) => {
    const body = request.body ?? {};
    for (const name of ['clientId', 'writeId']) {
      if (typeof body[name] !== 'string' || !/^[\w-]{1,100}$/.test(body[name])) throw new FsError(400, 'INVALID_BODY', formatString(strings.errors.invalidField, { name }));
    }
    response.json(await filesystem.write(body));
  });
  app.post('/api/files', async (request, response) => { await filesystem.createFile(request.body?.path); watcher.treeChanged(); response.status(201).json({ ok: true }); });
  app.post('/api/directories', async (request, response) => { await filesystem.createDirectory(request.body?.path); watcher.treeChanged(); response.status(201).json({ ok: true }); });
  app.patch('/api/files/rename', async (request, response) => {
    const { oldPath, newPath } = request.body ?? {};
    await filesystem.rename(oldPath, newPath);
    watcher.emit({ type: 'file-renamed', oldPath, newPath }); watcher.treeChanged();
    response.json({ ok: true });
  });
  app.delete('/api/files', async (request, response) => { await filesystem.remove(request.body?.path); watcher.treeChanged(); response.json({ ok: true }); });
  app.get('/api/assets', async (request, response) => {
    const asset = await filesystem.asset(request.query.path as string);
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.type(asset.type).send(asset.buffer);
  });
  app.get('/api/events', (request, response) => {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    const unsubscribe = watcher.subscribe(event => {
      // Slow clients reconnect and fully reconcile rather than accumulating unbounded queues.
      if (!response.write(`data: ${JSON.stringify(event)}\n\n`)) response.destroy();
    });
    response.write(`data: ${JSON.stringify({ type: 'ready' })}\n\n`);
    response.write(`data: ${JSON.stringify(watcher.status())}\n\n`);
    const heartbeat = setInterval(() => { if (!response.write(': heartbeat\n\n')) response.destroy(); }, 20000);
    request.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
  });
  app.use('/api', (_request, response) => { response.status(404).json({ error: strings.errors.endpointNotFound, code: 'NOT_FOUND' }); });
  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    const result = error.type === 'entity.too.large' ? new FsError(413, 'TOO_LARGE', strings.errors.requestTooLarge) :
      error.type === 'entity.parse.failed' ? new FsError(400, 'INVALID_BODY', strings.errors.invalidJson) : publicError(error);
    if (result.status >= 500) console.error(error);
    response.status(result.status).json({ error: result.message, code: result.code });
  };
  app.use(errors);
  return app;
}
