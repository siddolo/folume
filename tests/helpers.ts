import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { MarkdownFilesystem } from '../src/server/filesystem/markdown-filesystem.js';
import type { FsEvent } from '../src/shared/filesystem-types.js';
import type { WatcherService } from '../src/server/watcher/service.js';

export async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'folume-test-'));
  const filesystem = await MarkdownFilesystem.create(root);
  t.after(async () => { await filesystem.close(); await rm(root, { recursive: true, force: true }); });
  return { root, filesystem };
}

export function nextEvent(watcher: WatcherService, predicate: (event: FsEvent) => boolean) {
  return new Promise<FsEvent>((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error(`Evento watcher non ricevuto: ${predicate.toString()}`)); }, 5000);
    const unsubscribe = watcher.subscribe(event => {
      if (predicate(event)) { clearTimeout(timer); unsubscribe(); resolve(event); }
    });
  });
}

export async function until(predicate: () => boolean | Promise<boolean>, timeout = 5000) {
  const start = Date.now();
  while (!await predicate()) {
    if (Date.now() - start > timeout) throw new Error('Condizione non raggiunta.');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
