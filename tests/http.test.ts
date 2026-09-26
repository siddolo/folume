import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { config } from '../src/server/config.js';
import { createApp } from '../src/server/http.js';
import { WatcherService } from '../src/server/watcher/service.js';
import { fixture } from './helpers.js';

test('auth fails closed and validates explicit proxy delegation', () => {
  assert.throws(() => config({}));
  assert.throws(() => config({ MARKDOWN_ROOT: '/tmp' }));
  assert.throws(() => config({ MARKDOWN_ROOT: '/tmp', AUTH_MODE: 'none' }));
  assert.equal(config({ MARKDOWN_ROOT: '/tmp', AUTH_MODE: 'proxy' }).authMode, 'proxy');
  assert.equal(config({ AUTH_MODE: 'proxy' }).root, './notes');
  assert.throws(() => config({ MARKDOWN_ROOT: '/tmp', AUTH_MODE: 'proxy', PUBLIC_ORIGIN: 'https://example.com/path' }));
});

test('HTTP authentication, CSRF checks, error privacy, CRUD, conflict and SSE handshake', async t => {
  const { root, filesystem } = await fixture(t);
  const watcher = new WatcherService(filesystem);
  await watcher.start();
  const app = createApp(config({ MARKDOWN_ROOT: root, AUTH_USER: 'tester', AUTH_PASSWORD: 'test-password' }), filesystem, watcher);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { Authorization: `Basic ${Buffer.from('tester:test-password').toString('base64')}`, 'X-Folume-Request': '1', 'Content-Type': 'application/json' };
  const send = (route: string, method = 'GET', body?: unknown, extra = {}) => fetch(base + route, { method, headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.equal((await fetch(base + '/api/files/tree')).status, 401);
    assert.equal((await send('/api/files', 'POST', { path: 'new.md' }, { 'X-Folume-Request': '' })).status, 403);
    assert.equal((await send('/api/files', 'POST', { path: 'new.md' }, { Origin: 'https://evil.invalid' })).status, 403);
    assert.equal((await send('/api/files', 'POST', { path: 'new.md' }, { Origin: base })).status, 201);
    assert.equal((await send('/api/files', 'POST', { path: 'new.md' })).status, 409);
    const document = await (await send('/api/files/content?path=new.md')).json();
    const body = { path: 'new.md', content: '# HTTP\n', expectedRevision: document.revision, clientId: 'http', writeId: 'one' };
    assert.equal((await send('/api/files/content', 'PUT', body)).status, 200);
    assert.equal((await send('/api/files/content', 'PUT', body)).status, 409);
    const traversal = await send('/api/files/content?path=..%2Fprivate.md');
    assert.equal(traversal.status, 400);
    assert.ok(!(await traversal.text()).includes(root));
    assert.equal((await send('/api/files/content?path=a.md&path=b.md')).status, 400);
    assert.equal((await send('/api/files/rename', 'PATCH', { oldPath: 'new.md', newPath: 'renamed.md' })).status, 200);
    const controller = new AbortController();
    const events = await fetch(base + '/api/events', { headers, signal: controller.signal });
    assert.equal(events.headers.get('content-type'), 'text/event-stream');
    const reader = events.body!.getReader();
    const chunk = await reader.read();
    assert.match(new TextDecoder().decode(chunk.value), /"type":"ready"/);
    controller.abort();
    assert.equal((await send('/api/files', 'DELETE', { path: 'renamed.md' })).status, 200);
    assert.deepEqual(await (await send('/api/files/tree')).json(), []);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await watcher.close();
  }
});
