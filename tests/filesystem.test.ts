import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdir, symlink, stat, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.js';
import { FsError } from '../src/server/filesystem/errors.js';
import { MarkdownFilesystem } from '../src/server/filesystem/markdown-filesystem.js';

const write = (path: string, content: string, expectedRevision: string) => ({ path, content, expectedRevision, clientId: 'browser', writeId: 'write1' });

test('path: rejects traversal, absolute paths, hidden files, invalid segments and file types', async t => {
  const { filesystem } = await fixture(t);
  for (const name of ['../escape.md', '/etc/passwd', 'a/../../escape.md', 'a//b.md', './a.md', 'C:/a.md', 'a\\b.md', 'a\0.md', '.git/config.md', 'a/.hidden.md', '', 'file.txt']) {
    await assert.rejects(filesystem.read(name));
    await assert.rejects(filesystem.createFile(name));
  }
  await assert.rejects(filesystem.remove(''));
  await assert.rejects(filesystem.rename('a.md', '../a.md'));
  await assert.rejects(filesystem.asset('../image.png'));
  await assert.rejects(filesystem.asset('script.svg'));
});

test('symlinks cannot be read, written, renamed, traversed or served as assets', async t => {
  const { root, filesystem } = await fixture(t);
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'note.md'), 'private');
  await writeFile(path.join(outside, 'pic.png'), 'image');
  await symlink(outside, path.join(root, 'linked'));
  await symlink(path.join(outside, 'note.md'), path.join(root, 'link.md'));
  await symlink(path.join(outside, 'pic.png'), path.join(root, 'link.png'));
  await assert.rejects(filesystem.read('linked/note.md'));
  await assert.rejects(filesystem.read('link.md'));
  await assert.rejects(filesystem.write(write('link.md', 'bad', 'x')));
  await assert.rejects(filesystem.createFile('linked/new.md'));
  await assert.rejects(filesystem.createDirectory('linked/new'));
  await assert.rejects(filesystem.rename('link.md', 'new.md'));
  await assert.rejects(filesystem.remove('linked'));
  await assert.rejects(filesystem.asset('link.png'));
  await assert.rejects(filesystem.asset('linked/pic.png'));
  assert.equal(await readFile(path.join(outside, 'note.md'), 'utf8'), 'private');
  assert.deepEqual((await filesystem.tree()).map(node => node.name), ['outside']);
  await assert.rejects(MarkdownFilesystem.create(path.join(root, 'linked')));
});

test('reads UTF-8, hashes exact bytes, preserves final newline and mode, and writes atomically', async t => {
  const { root, filesystem } = await fixture(t);
  await writeFile(path.join(root, 'hello.md'), '\uFEFF# Caffè\n', { mode: 0o640 });
  const original = await filesystem.read('hello.md');
  assert.equal(original.content, '\uFEFF# Caffè\n');
  assert.match(original.revision, /^[a-f0-9]{64}$/);
  const before = await stat(path.join(root, 'hello.md'));
  const saved = await filesystem.write(write('hello.md', '# Caffè modificato', original.revision));
  assert.equal(saved.content, '\uFEFF# Caffè modificato\n');
  assert.equal(await readFile(path.join(root, 'hello.md'), 'utf8'), saved.content);
  assert.notEqual(saved.revision, original.revision);
  const after = await stat(path.join(root, 'hello.md'));
  assert.notEqual(after.ino, before.ino);
  assert.equal(after.mode & 0o777, 0o640);
  assert.deepEqual(await readdir(root), ['hello.md']);
  assert.deepEqual(filesystem.originFor('hello.md', saved.revision), { origin: 'browser', writeId: 'write1' });
  assert.deepEqual(filesystem.originFor('hello.md', 'external'), {});
});

test('stale and concurrent writes conflict without clobbering disk', async t => {
  const { root, filesystem } = await fixture(t);
  await filesystem.createFile('a.md');
  const original = await filesystem.read('a.md');
  const results = await Promise.allSettled([
    filesystem.write(write('a.md', 'one', original.revision)),
    filesystem.write(write('a.md', 'two', original.revision)),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'CONFLICT').length, 1);
  const saved = await filesystem.read('a.md');
  await writeFile(path.join(root, 'a.md'), 'external\n');
  await assert.rejects(filesystem.write(write('a.md', 'overwrite', saved.revision)), (error: unknown) => error instanceof FsError && error.code === 'CONFLICT');
  assert.equal(await readFile(path.join(root, 'a.md'), 'utf8'), 'external\n');
  assert.deepEqual(await readdir(root), ['a.md']);
});

test('atomic writes never expose partially written content to external readers', async t => {
  const { root, filesystem } = await fixture(t);
  const oldContent = 'a'.repeat(300000), newContent = 'b'.repeat(300000);
  await writeFile(path.join(root, 'a.md'), oldContent);
  const current = await filesystem.read('a.md');
  let running = true;
  const reader = (async () => {
    while (running) {
      const text = await readFile(path.join(root, 'a.md'), 'utf8');
      assert.ok(text === oldContent || text === newContent);
    }
  })();
  try { await filesystem.write(write('a.md', newContent, current.revision)); }
  finally { running = false; await reader; }
});

test('tree order and CRUD preserve paths including spaces and Unicode; rename refuses overwrite', async t => {
  const { root, filesystem } = await fixture(t);
  await filesystem.createDirectory('Note è');
  await filesystem.createDirectory('Note è/Nested');
  await filesystem.createFile('Note è/Nested/test.md');
  for (const name of ['10.md', '2.md', '1.MD']) await filesystem.createFile(name);
  await writeFile(path.join(root, 'ignored.txt'), 'ignored');
  assert.deepEqual((await filesystem.tree()).map(node => node.name), ['Note è', '1.MD', '2.md', '10.md']);
  await filesystem.rename('Note è', 'Moved');
  assert.equal((await filesystem.read('Moved/Nested/test.md')).content, '\n');
  await filesystem.rename('Moved/Nested/test.md', 'Moved/Nested/renamed.md');
  await assert.rejects(filesystem.rename('1.MD', '2.md'));
  await assert.rejects(filesystem.rename('Moved', 'Moved/Nested/cycle'));
  await filesystem.remove('Moved');
  await assert.rejects(filesystem.read('Moved/Nested/renamed.md'));
  await assert.rejects(filesystem.remove('ignored.txt'));
});

test('invalid UTF-8 and oversized files are rejected without modification', async t => {
  const { root, filesystem } = await fixture(t);
  await writeFile(path.join(root, 'bad.md'), Buffer.from([0xff, 0xfe, 0x80]));
  await assert.rejects(filesystem.read('bad.md'), (error: unknown) => error instanceof FsError && error.code === 'ENCODING');
  await writeFile(path.join(root, 'big.md'), Buffer.alloc(filesystem.maxBytes + 1));
  await assert.rejects(filesystem.read('big.md'), (error: unknown) => error instanceof FsError && error.status === 413);
});

test('replacing a directory with a symlink cannot redirect later writes', async t => {
  const { root, filesystem } = await fixture(t);
  await filesystem.createDirectory('notes'); await filesystem.createFile('notes/a.md');
  const original = await filesystem.read('notes/a.md');
  await rename(path.join(root, 'notes'), path.join(root, 'moved'));
  await symlink(path.join(root, 'moved'), path.join(root, 'notes'));
  await assert.rejects(filesystem.write(write('notes/a.md', 'bad', original.revision)));
  assert.equal(await readFile(path.join(root, 'moved/a.md'), 'utf8'), '\n');
});
