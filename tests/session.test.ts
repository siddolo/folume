import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from '../src/app/api.js';
import { DocumentSession, type DocumentTransport } from '../src/app/document-session.js';
import { publicError } from '../src/server/filesystem/errors.js';
import { fixture, until } from './helpers.js';
import { WatcherService } from '../src/server/watcher/service.js';

async function setup(t: Parameters<typeof fixture>[0]) {
  const { root, filesystem } = await fixture(t);
  await filesystem.createFile('note.md');
  let writes = 0;
  const wrap = async <T>(promise: Promise<T>) => {
    try { return await promise; } catch (error) { const e = publicError(error); throw new ApiError(e.status, e.code, e.message); }
  };
  const transport: DocumentTransport = {
    read: name => wrap(filesystem.read(name)),
    write: request => { writes++; return wrap(filesystem.write(request)); },
  };
  const session = new DocumentSession(transport, 60000);
  t.after(() => session.dispose());
  await session.open('note.md');
  return { root, filesystem, session, transport, writes: () => writes };
}

test('clean external change reloads; dirty external change preserves local text and blocks autosave', async t => {
  const { root, session, filesystem } = await setup(t);
  await writeFile(path.join(root, 'note.md'), 'outside\n');
  await session.synchronize();
  assert.equal(session.getSnapshot().content, 'outside\n');
  session.edit('local edit');
  await writeFile(path.join(root, 'note.md'), 'outside again\n');
  await session.synchronize();
  assert.equal(session.getSnapshot().content, 'local edit');
  assert.equal(session.getSnapshot().conflict, true);
  await session.save();
  assert.equal((await filesystem.read('note.md')).content, 'outside again\n');
  await session.overwrite();
  assert.equal((await filesystem.read('note.md')).content, 'local edit\n');
  assert.equal(session.getSnapshot().dirty, false);
});

test('own watcher event before HTTP completion never reloads editor or forms a save loop', async t => {
  const { session, transport, writes } = await setup(t);
  const write = transport.write;
  transport.write = async request => {
    const result = await write(request);
    await session.event({ type: 'file-changed', path: request.path, revision: result.revision, origin: request.clientId, writeId: request.writeId });
    return result;
  };
  const version = session.getSnapshot().editorVersion;
  session.edit('typed');
  await session.save();
  assert.equal(writes(), 1);
  assert.equal(session.getSnapshot().editorVersion, version);
  assert.equal(session.getSnapshot().dirty, false);
  assert.equal(session.getSnapshot().conflict, false);
});

test('typing during an in-flight write is retained and subsequent save uses the new revision', async t => {
  const { session, transport, filesystem } = await setup(t);
  const original = transport.write;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  transport.write = async request => { await barrier; return original(request); };
  session.edit('first');
  const pending = session.save();
  session.edit('first and second');
  release(); await pending;
  assert.equal(session.getSnapshot().content, 'first and second');
  assert.equal(session.getSnapshot().dirty, true);
  await session.save();
  assert.equal((await filesystem.read('note.md')).content, 'first and second\n');
});

test('lost response followed by reconnect surfaces conflict and retains the local version', async t => {
  const { session, transport } = await setup(t);
  const original = transport.write;
  transport.write = async request => { await original(request); throw new Error('Network lost'); };
  session.edit('important'); await session.save();
  assert.equal(session.getSnapshot().content, 'important');
  assert.equal(session.getSnapshot().dirty, true);
  await session.event({ type: 'ready' });
  assert.equal(session.getSnapshot().conflict, true);
  await session.reload();
  assert.equal(session.getSnapshot().content, 'important\n');
  assert.equal(session.getSnapshot().dirty, false);
});

test('deletion, rename and failed navigation do not discard local content', async t => {
  const { session, root, filesystem } = await setup(t);
  session.edit('preserve me');
  await filesystem.rename('note.md', 'new.md');
  await session.event({ type: 'file-renamed', oldPath: 'note.md', newPath: 'new.md' });
  assert.equal(session.getSnapshot().path, 'new.md');
  assert.equal(session.getSnapshot().content, 'preserve me');
  await unlink(path.join(root, 'new.md'));
  await session.event({ type: 'file-deleted', path: 'new.md' });
  assert.equal(session.getSnapshot().missing, true);
  assert.equal(await session.open('not-found.md', true), false);
  assert.equal(session.getSnapshot().content, 'preserve me');
  await session.save();
  assert.equal(session.getSnapshot().content, 'preserve me');
});

test('late read response cannot erase editing or load the wrong document', async t => {
  const { session, transport, root } = await setup(t);
  await writeFile(path.join(root, 'other.md'), 'other');
  const original = transport.read;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  transport.read = async name => { const result = await original(name); await barrier; return result; };
  const loading = session.open('other.md');
  session.edit('typed during read');
  release();
  assert.equal(await loading, false);
  assert.equal(session.getSnapshot().content, 'typed during read');
  assert.equal(session.getSnapshot().path, 'note.md');
});

test('two sessions and real watcher: clean reader follows; dirty reader conflicts', async t => {
  const { session, transport, filesystem } = await setup(t);
  const second = new DocumentSession(transport, 60000);
  await second.open('note.md');
  const watcher = new WatcherService(filesystem);
  await watcher.start();
  watcher.subscribe(event => { void session.event(event); void second.event(event); });
  try {
    session.edit('first client'); await session.save();
    await until(() => second.getSnapshot().content === 'first client\n');
    second.edit('unsaved second client');
    session.edit('new first client'); await session.save();
    await until(() => second.getSnapshot().conflict);
    assert.equal(second.getSnapshot().content, 'unsaved second client');
    assert.equal(session.getSnapshot().conflict, false);
  } finally { second.dispose(); await watcher.close(); }
});
