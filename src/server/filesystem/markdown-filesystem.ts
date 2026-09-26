import { constants } from 'node:fs';
import { open, realpath, lstat, readdir, rename, unlink, mkdir, rm, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { FileDocument, FsNode, WriteRequest } from '../../shared/filesystem-types.js';
import { strings } from '../../shared/strings.js';
import { FsError } from './errors.js';
import { hidden, isMarkdown, markdownPath, relativePath } from './paths.js';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fdPath = (handle: FileHandle) => `/proc/self/fd/${handle.fd}`;
const assetTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
};

/** Linux dirfd anchoring prevents a checked ancestor being replaced by a symlink. */
export class MarkdownFilesystem {
  private queue: Promise<unknown> = Promise.resolve();
  private origins = new Map<string, { revision: string; origin: string; writeId: string }>();
  private constructor(readonly root: string, private rootHandle: FileHandle, readonly maxBytes: number) {}

  static async create(root: string, maxBytes = 5 * 1024 * 1024) {
    const absolute = path.resolve(root);
    if (await realpath(absolute) !== absolute || (await lstat(absolute)).isSymbolicLink()) {
      throw new Error(strings.config.rootSymlinkNotAllowed);
    }
    return new MarkdownFilesystem(absolute, await open(absolute, directoryFlags), maxBytes);
  }

  async close() { await this.queue; await this.rootHandle.close(); }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  private async directory(relative: string): Promise<FileHandle> {
    relativePath(relative, true);
    let handle = await open(fdPath(this.rootHandle), constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      for (const segment of relative ? relative.split('/') : []) {
        const next = await open(`${fdPath(handle)}/${segment}`, directoryFlags);
        await handle.close();
        handle = next;
      }
      return handle;
    } catch (error) { await handle.close(); throw error; }
  }

  private async withParent<T>(relative: string, operation: (target: string, parent: FileHandle) => Promise<T>) {
    relativePath(relative);
    const parentName = path.posix.dirname(relative);
    const parent = await this.directory(parentName === '.' ? '' : parentName);
    try { return await operation(`${fdPath(parent)}/${path.posix.basename(relative)}`, parent); }
    finally { await parent.close(); }
  }

  private async bytes(target: string, maxBytes = this.maxBytes) {
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new FsError(400, 'FILE_TYPE', strings.errors.notRegularFile);
      if (stat.size > maxBytes) throw new FsError(413, 'TOO_LARGE', strings.errors.fileTooLarge);
      // Bounded allocation even if an external process appends after stat().
      const buffer = Buffer.alloc(Math.min(stat.size + 1, maxBytes + 1));
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      const after = await handle.stat();
      if (offset > maxBytes) throw new FsError(413, 'TOO_LARGE', strings.errors.fileTooLarge);
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || offset !== stat.size) {
        throw new FsError(409, 'CHANGING', strings.errors.fileChanging);
      }
      return { buffer: buffer.subarray(0, offset), stat };
    } finally { await handle.close(); }
  }

  private decode(buffer: Buffer) {
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); }
    catch { throw new FsError(422, 'ENCODING', strings.errors.invalidUtf8); }
  }

  async read(input: string): Promise<FileDocument> {
    const relative = markdownPath(input);
    return this.withParent(relative, async target => {
      const { buffer } = await this.bytes(target);
      return { path: relative, content: this.decode(buffer), revision: hash(buffer) };
    });
  }

  async readAfterWrites(input: string): Promise<FileDocument> {
    // Observe completed app mutations, including their hash/origin registration.
    await this.queue;
    return this.read(input);
  }

  async tree(): Promise<FsNode[]> {
    const collator = new Intl.Collator(strings.locale, { numeric: true, sensitivity: 'base' });
    const visit = async (relative: string): Promise<FsNode[]> => {
      const directory = await this.directory(relative);
      try {
        const entries = await readdir(fdPath(directory), { withFileTypes: true });
        const nodes: FsNode[] = [];
        for (const entry of entries) {
          if (hidden(entry.name) || entry.isSymbolicLink()) continue;
          const child = relative ? `${relative}/${entry.name}` : entry.name;
          try {
            if (entry.isDirectory()) nodes.push({ type: 'directory', name: entry.name, path: child, children: await visit(child) });
            else if (entry.isFile() && isMarkdown(entry.name)) nodes.push({ type: 'file', name: entry.name, path: child });
          } catch (error) {
            if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) continue;
            throw error;
          }
        }
        return nodes.sort((a, b) => (a.type === b.type ? collator.compare(a.name, b.name) : a.type === 'directory' ? -1 : 1));
      } finally { await directory.close(); }
    };
    return visit('');
  }

  async write(request: WriteRequest): Promise<FileDocument> {
    const relative = markdownPath(request.path);
    if (typeof request.content !== 'string' || typeof request.expectedRevision !== 'string') {
      throw new FsError(400, 'INVALID_BODY', strings.errors.contentAndRevisionRequired);
    }
    return this.exclusive(() => this.withParent(relative, async (target, parent) => {
      const current = await this.bytes(target);
      if (hash(current.buffer) !== request.expectedRevision) throw new FsError(409, 'CONFLICT', strings.errors.revisionConflict);
      const previous = this.decode(current.buffer);
      let content = request.content;
      if (previous.startsWith('\uFEFF') && !content.startsWith('\uFEFF')) content = '\uFEFF' + content;
      if (previous.endsWith('\n') && !content.endsWith('\n')) content += '\n';
      const buffer = Buffer.from(content, 'utf8');
      if (buffer.length > this.maxBytes) throw new FsError(413, 'TOO_LARGE', strings.errors.fileTooLarge);
      const revision = hash(buffer);
      if (revision === request.expectedRevision) return { path: relative, content, revision };
      const temporary = `${fdPath(parent)}/.folume-${randomUUID()}.tmp`;
      let temp: FileHandle | undefined;
      try {
        temp = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        await temp.writeFile(buffer);
        await temp.chmod(current.stat.mode & 0o777);
        await temp.sync();
        await temp.close(); temp = undefined;
        const latest = await this.bytes(target);
        if (hash(latest.buffer) !== request.expectedRevision || latest.stat.ino !== current.stat.ino) {
          throw new FsError(409, 'CONFLICT', strings.errors.changedDuringSave);
        }
        await rename(temporary, target);
        // Registered before any watcher callback can finish its asynchronous read.
        this.origins.delete(relative);
        this.origins.set(relative, { revision, origin: request.clientId, writeId: request.writeId });
        if (this.origins.size > 4096) this.origins.delete(this.origins.keys().next().value!);
        await parent.sync();
        return { path: relative, content, revision };
      } finally {
        await temp?.close();
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    }));
  }

  originFor(relative: string, revision: string) {
    const origin = this.origins.get(relative);
    if (origin?.revision === revision) return { origin: origin.origin, writeId: origin.writeId };
    this.origins.delete(relative);
    return {};
  }

  forget(relative: string) { this.origins.delete(relative); }

  async createFile(input: string) {
    const relative = markdownPath(input);
    await this.exclusive(() => this.withParent(relative, async (target, parent) => {
      const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile('\n'); await handle.sync(); } finally { await handle.close(); }
      await parent.sync();
    }));
  }

  async createDirectory(input: string) {
    const relative = relativePath(input);
    await this.exclusive(() => this.withParent(relative, async (target, parent) => { await mkdir(target, { mode: 0o700 }); await parent.sync(); }));
  }

  async rename(oldInput: string, newInput: string) {
    const oldPath = relativePath(oldInput), newPath = relativePath(newInput);
    if (newPath.startsWith(oldPath + '/')) throw new FsError(400, 'INVALID_PATH', strings.errors.directoryContainsItself);
    await this.exclusive(() => this.withParent(oldPath, async (source, sourceParent) => {
      const stat = await lstat(source);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new FsError(400, 'FILE_TYPE', strings.errors.fileTypeNotAllowed);
      if (stat.isFile()) { markdownPath(oldPath); markdownPath(newPath); }
      await this.withParent(newPath, async (destination, destinationParent) => {
        try { await lstat(destination); throw new FsError(409, 'EXISTS', strings.errors.destinationExists); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await rename(source, destination);
        await sourceParent.sync(); await destinationParent.sync();
      });
      this.origins.clear();
    }));
  }

  async remove(input: string) {
    const relative = relativePath(input);
    await this.exclusive(() => this.withParent(relative, async (target, parent) => {
      const stat = await lstat(target);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new FsError(400, 'FILE_TYPE', strings.errors.fileTypeNotAllowed);
      if (stat.isFile()) markdownPath(relative);
      await rm(target, { recursive: stat.isDirectory(), force: false });
      this.origins.clear();
      await parent.sync();
    }));
  }

  async asset(input: string) {
    const relative = relativePath(input);
    const type = assetTypes[path.extname(relative).toLowerCase()];
    if (!type) throw new FsError(400, 'FILE_TYPE', strings.errors.assetNotAllowed);
    return this.withParent(relative, async target => ({ type, buffer: (await this.bytes(target, 20 * 1024 * 1024)).buffer }));
  }
}
