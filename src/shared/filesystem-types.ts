export type FsNode =
  | { type: 'directory'; name: string; path: string; children: FsNode[] }
  | { type: 'file'; name: string; path: string };

export interface FileDocument { path: string; content: string; revision: string }
export interface WriteRequest {
  path: string;
  content: string;
  expectedRevision: string;
  clientId: string;
  writeId: string;
}
export type FsEvent =
  | { type: 'tree-changed' }
  | { type: 'file-changed'; path: string; revision: string; origin?: string; writeId?: string }
  | { type: 'file-deleted'; path: string }
  | { type: 'file-renamed'; oldPath: string; newPath: string }
  | { type: 'watcher-status'; available: boolean; message?: string }
  | { type: 'ready' };

export interface ApiErrorBody { error: string; code: string }
