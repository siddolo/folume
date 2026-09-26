import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { FsEvent } from '../src/shared/filesystem-types.js';
import { until } from './helpers.js';

const execute = promisify(execFile);
const root = await mkdtemp(path.join(tmpdir(), 'folume-docker-'));
const name = `folume-smoke-${randomUUID()}`;
const abort = new AbortController();
let eventsTask: Promise<void> | undefined;
try {
  await writeFile(path.join(root, 'note.md'), '# Before\n');
  await execute('docker', [
    'run', '--rm', '-d', '--name', name,
    '--user', `${process.getuid!()}:${process.getgid!()}`,
    '--mount', `type=bind,source=${root},target=/data/notes`,
    '-p', '127.0.0.1::3000',
    '-e', 'AUTH_MODE=basic', '-e', 'AUTH_USER=test', '-e', 'AUTH_PASSWORD=container-test-password',
    'folume:local',
  ]);
  const { stdout } = await execute('docker', ['port', name, '3000/tcp']);
  const base = `http://${stdout.trim()}`;
  const headers = { Authorization: `Basic ${Buffer.from('test:container-test-password').toString('base64')}`, 'Content-Type': 'application/json', 'X-Folume-Request': '1' };
  await until(async () => { try { return (await fetch(base)).status === 401; } catch { return false; } });
  const page = await fetch(base, { headers });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Folume<\/title>/);
  const initial = await (await fetch(`${base}/api/files/content?path=note.md`, { headers })).json();
  const stream = await fetch(`${base}/api/events`, { headers, signal: abort.signal });
  const events: FsEvent[] = [];
  eventsTask = (async () => {
    const reader = stream.body!.getReader(), decoder = new TextDecoder();
    let pending = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return;
        pending += decoder.decode(chunk.value, { stream: true });
        let end: number;
        while ((end = pending.indexOf('\n\n')) !== -1) {
          const frame = pending.slice(0, end); pending = pending.slice(end + 2);
          if (frame.startsWith('data: ')) events.push(JSON.parse(frame.slice(6)) as FsEvent);
        }
      }
    } catch (error) { if (!abort.signal.aborted) throw error; }
  })();
  await until(() => events.some(event => event.type === 'ready'));
  const saved = await fetch(`${base}/api/files/content`, {
    method: 'PUT', headers,
    body: JSON.stringify({ path: 'note.md', content: '# Saved inside container', expectedRevision: initial.revision, clientId: 'container-client', writeId: 'container-write' }),
  });
  assert.equal(saved.status, 200);
  assert.equal(await readFile(path.join(root, 'note.md'), 'utf8'), '# Saved inside container\n');
  await until(() => events.some(event => event.type === 'file-changed' && event.origin === 'container-client'));
  await writeFile(path.join(root, 'note.md'), '# Edited on host\n');
  await until(() => events.some(event => event.type === 'file-changed' && event.path === 'note.md' && !event.origin));
  await writeFile(path.join(root, 'new.md'), '# Created on host\n');
  await until(() => events.some(event => event.type === 'file-changed' && event.path === 'new.md'));
  const tree = await (await fetch(`${base}/api/files/tree`, { headers })).json();
  assert.deepEqual(tree.map((node: { path: string }) => node.path), ['new.md', 'note.md']);
  console.info('Docker smoke passed: authenticated production UI, atomic save on bind mount, native watcher for host edits and creates, own-write attribution.');
} catch (error) {
  const logs = await execute('docker', ['logs', name]).catch(() => ({ stdout: '', stderr: '' }));
  console.error(logs.stdout, logs.stderr);
  throw error;
} finally {
  abort.abort();
  await eventsTask;
  await execute('docker', ['rm', '-f', name]).catch(() => {});
  await rm(root, { recursive: true, force: true });
}
