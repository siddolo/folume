import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rename, unlink, mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { WatcherService } from '../src/server/watcher/service.js';
import { fixture, nextEvent } from './helpers.js';

test('one watcher fans out external edits, own writes, atomic replacement and structure changes', async t => {
  const { root, filesystem } = await fixture(t);
  await filesystem.createFile('note.md');
  const watcher = new WatcherService(filesystem);
  await watcher.start();
  try {
    const one = nextEvent(watcher, event => event.type === 'file-changed' && event.path === 'note.md');
    const two = nextEvent(watcher, event => event.type === 'file-changed' && event.path === 'note.md');
    await writeFile(path.join(root, 'note.md'), '# External\n');
    const external = await one;
    assert.deepEqual(await two, external);
    assert.equal(external.type, 'file-changed');
    if (external.type !== 'file-changed') return;
    assert.equal(external.origin, undefined);
    const ownEvent = nextEvent(watcher, event => event.type === 'file-changed' && event.origin === 'client-A');
    const saved = await filesystem.write({ path: 'note.md', content: '# Internal\n', expectedRevision: external.revision, clientId: 'client-A', writeId: 'write-A' });
    const own = await ownEvent;
    assert.deepEqual(own, { type: 'file-changed', path: 'note.md', revision: saved.revision, origin: 'client-A', writeId: 'write-A' });
    const replacement = nextEvent(watcher, event => event.type === 'file-changed' && event.path === 'note.md' && event.revision !== saved.revision);
    await writeFile(path.join(root, '.external.tmp'), '# Atomic external\n');
    await rename(path.join(root, '.external.tmp'), path.join(root, 'note.md'));
    const replaced = await replacement;
    assert.ok(replaced.type === 'file-changed' && !replaced.origin);
    const created = nextEvent(watcher, event => event.type === 'file-changed' && event.path === 'new.md');
    const tree = nextEvent(watcher, event => event.type === 'tree-changed');
    await writeFile(path.join(root, 'new.md'), '# New\n');
    await created; await tree;
    const removed = nextEvent(watcher, event => event.type === 'file-deleted' && event.path === 'new.md');
    const added = nextEvent(watcher, event => event.type === 'file-changed' && event.path === 'renamed.md');
    await rename(path.join(root, 'new.md'), path.join(root, 'renamed.md'));
    await removed; await added;
    const deleted = nextEvent(watcher, event => event.type === 'file-deleted' && event.path === 'renamed.md');
    await unlink(path.join(root, 'renamed.md')); await deleted;
    const directoryAdded = nextEvent(watcher, event => event.type === 'tree-changed');
    await mkdir(path.join(root, 'folder')); await directoryAdded;
    const directoryRemoved = nextEvent(watcher, event => event.type === 'tree-changed');
    await rmdir(path.join(root, 'folder')); await directoryRemoved;
  } finally { await watcher.close(); }
});

test('configurable polling fallback reports external changes', async t => {
  const { root, filesystem } = await fixture(t);
  await filesystem.createFile('note.md');
  const watcher = new WatcherService(filesystem, true, 100);
  await watcher.start();
  try {
    const event = nextEvent(watcher, value => value.type === 'file-changed');
    await writeFile(path.join(root, 'note.md'), 'poll fallback\n');
    assert.equal((await event).type, 'file-changed');
  } finally { await watcher.close(); }
});
