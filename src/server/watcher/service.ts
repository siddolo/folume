import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { FsEvent } from '../../shared/filesystem-types.js';
import { strings } from '../../shared/strings.js';
import type { MarkdownFilesystem } from '../filesystem/markdown-filesystem.js';
import { isMarkdown } from '../filesystem/paths.js';

export class WatcherService {
  private bus = new EventEmitter();
  private watcher?: FSWatcher;
  private queue: Promise<unknown> = Promise.resolve();
  private treeTimer?: ReturnType<typeof setTimeout>;
  private available = true;
  private pending = new Set<string>();
  private revisions = new Map<string, string>();

  constructor(private filesystem: MarkdownFilesystem, private polling = false, private interval = 1500) {
    this.bus.setMaxListeners(0);
  }

  emit(event: FsEvent) { this.bus.emit('event', event); }
  subscribe(listener: (event: FsEvent) => void) { this.bus.on('event', listener); return () => { this.bus.off('event', listener); }; }
  status(): FsEvent { return { type: 'watcher-status', available: this.available, message: this.available ? undefined : strings.server.watcherUnavailable }; }

  async start() {
    if (this.watcher) throw new Error(strings.server.watcherAlreadyStarted);
    this.watcher = chokidar.watch(this.filesystem.root, {
      persistent: true, ignoreInitial: true, followSymlinks: false,
      usePolling: this.polling, interval: this.interval, binaryInterval: this.interval,
      atomic: true,
      ignored: (absolute, stat) => {
        const relative = path.relative(this.filesystem.root, absolute);
        return relative.split(path.sep).some(part => part.startsWith('.')) || !!stat?.isSymbolicLink();
      },
    });
    this.watcher.on('all', (kind, absolute) => {
      const relative = path.relative(this.filesystem.root, absolute).split(path.sep).join('/');
      if (!relative || relative.startsWith('../')) return;
      if (kind !== 'change') this.treeChanged();
      if (!isMarkdown(relative) || kind === 'addDir' || kind === 'unlinkDir') return;
      this.reconcile(relative);
    });
    // Chokidar coalesces high-level change events for 50ms. Native raw hints ensure
    // a second quick write is still reconciled; hashes, not time, deduplicate it.
    this.watcher.on('raw', (kind, name, details) => {
      const watched = (details as { watchedPath?: string }).watchedPath;
      const absolute = path.isAbsolute(name) ? name : watched
        ? path.basename(watched) === name ? watched : path.join(watched, name)
        : null;
      if (!absolute) return;
      const relative = path.relative(this.filesystem.root, absolute).split(path.sep).join('/');
      if (!relative || relative.split('/').some(part => part.startsWith('.'))) return;
      if (kind === 'rename') this.treeChanged();
      if (isMarkdown(relative)) this.reconcile(relative);
    });
    this.watcher.on('error', error => {
      this.available = false;
      console.error(strings.server.watcherError, error);
      this.emit(this.status());
    });
    await new Promise<void>((resolve, reject) => {
      this.watcher!.once('ready', resolve);
      this.watcher!.once('error', reject);
    });
  }

  private reconcile(relative: string) {
    if (this.pending.has(relative)) return;
    this.pending.add(relative);
    this.queue = this.queue.then(async () => {
      this.pending.delete(relative);
      try {
        const document = await this.filesystem.readAfterWrites(relative);
        if (this.revisions.get(relative) === document.revision) return;
        this.revisions.set(relative, document.revision);
        this.emit({ type: 'file-changed', path: relative, revision: document.revision, ...this.filesystem.originFor(relative, document.revision) });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          this.revisions.delete(relative);
          this.filesystem.forget(relative);
          this.emit({ type: 'file-deleted', path: relative });
        } else {
          this.revisions.delete(relative);
          this.emit({ type: 'file-changed', path: relative, revision: '' });
        }
      }
    }).catch(error => { console.error(strings.server.watcherEventError, error); });
  }

  treeChanged() {
    // Only coalesces tree refreshes; never suppresses content/write events.
    if (!this.treeTimer) this.treeTimer = setTimeout(() => {
      this.treeTimer = undefined;
      this.emit({ type: 'tree-changed' });
    }, 60);
  }

  async close() { clearTimeout(this.treeTimer); await this.watcher?.close(); await this.queue; this.bus.removeAllListeners(); }
}
