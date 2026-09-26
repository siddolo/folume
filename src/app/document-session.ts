import type { FileDocument, FsEvent, WriteRequest } from '../shared/filesystem-types';
import { strings } from '../shared/strings';
import { ApiError, identifier } from './api';

export interface DocumentState {
  path: string | null;
  content: string;
  revision: string;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  conflict: boolean;
  missing: boolean;
  error: string | null;
  /** Changes only when the editor must explicitly replace its runtime document. */
  editorVersion: number;
}
export interface DocumentTransport {
  read(path: string): Promise<FileDocument>;
  write(request: WriteRequest): Promise<FileDocument>;
}

export class DocumentSession {
  private state: DocumentState = { path: null, content: '', revision: '', dirty: false, saving: false, loading: false, conflict: false, missing: false, error: null, editorVersion: 0 };
  private listeners = new Set<() => void>();
  private base = '';
  private editVersion = 0;
  private documentId = 0;
  private loadId = 0;
  private syncId = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<void>;
  private writeId?: string;
  private reconcileAfterSave = false;
  readonly clientId = identifier();

  constructor(private transport: DocumentTransport, private debounce = 750) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<DocumentState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  private replace(document: FileDocument) {
    this.base = document.content;
    this.editVersion++;
    this.update({ ...document, dirty: false, conflict: false, missing: false, loading: false, error: null, editorVersion: this.state.editorVersion + 1 });
  }

  async open(path: string, discard = false): Promise<boolean> {
    if (this.inFlight) await this.inFlight;
    if (this.state.dirty && !discard) return false;
    clearTimeout(this.timer);
    const load = ++this.loadId, edit = this.editVersion;
    this.update({ loading: true, error: null });
    try {
      const document = await this.transport.read(path);
      if (load !== this.loadId) return false;
      if (edit !== this.editVersion) {
        this.update({ loading: false, error: strings.session.editedDuringOpen });
        return false;
      }
      this.documentId++;
      this.syncId++;
      this.replace(document);
      // Covers filesystem events received while this document was still loading.
      await this.synchronize();
      return true;
    } catch (error) {
      if (load === this.loadId) this.update({ loading: false, error: this.message(error) });
      return false;
    }
  }

  edit(content: string) {
    if (!this.state.path || content === this.state.content) return;
    this.editVersion++;
    this.update({ content, dirty: content !== this.base });
    this.schedule();
  }

  private schedule() {
    clearTimeout(this.timer);
    if (this.state.dirty && !this.state.conflict && !this.state.missing && !this.state.error && !this.state.saving) {
      this.timer = setTimeout(() => { void this.save(); }, this.debounce);
    }
  }

  async save(): Promise<void> {
    clearTimeout(this.timer);
    if (this.inFlight) { await this.inFlight; return this.save(); }
    if (!this.state.path || !this.state.dirty || this.state.conflict || this.state.missing) return;
    const { path, content, revision } = this.state;
    const id = this.documentId, edit = this.editVersion;
    const writeId = identifier(); this.writeId = writeId;
    this.update({ saving: true, error: null });
    this.inFlight = (async () => {
      try {
        const result = await this.transport.write({ path, content, expectedRevision: revision, clientId: this.clientId, writeId });
        if (id !== this.documentId) return;
        this.base = result.content;
        const unchanged = edit === this.editVersion;
        this.update({ revision: result.revision, content: unchanged ? result.content : this.state.content, dirty: !unchanged && this.state.content !== result.content });
      } catch (error) {
        if (id === this.documentId) this.failure(error);
      } finally {
        this.inFlight = undefined; this.writeId = undefined;
        this.update({ saving: false });
        if (this.reconcileAfterSave) {
          this.reconcileAfterSave = false;
          await this.synchronize();
        }
        this.schedule();
      }
    })();
    await this.inFlight;
  }

  async synchronize() {
    if (!this.state.path) return;
    if (this.state.saving) { this.reconcileAfterSave = true; return; }
    const id = this.documentId, path = this.state.path, sync = ++this.syncId;
    try {
      const document = await this.transport.read(path);
      if (id !== this.documentId || path !== this.state.path || sync !== this.syncId) return;
      if (this.state.saving) { this.reconcileAfterSave = true; return; }
      if (document.revision === this.state.revision) {
        if (this.state.missing || this.state.error) {
          this.update({ missing: false, error: null });
          this.schedule();
        }
        return;
      }
      if (this.state.dirty || this.state.conflict || this.state.missing) {
        clearTimeout(this.timer);
        this.update({ conflict: true, missing: false, error: null });
      } else this.replace(document);
    } catch (error) {
      if (id === this.documentId && path === this.state.path && sync === this.syncId) this.failure(error);
    }
  }

  async event(event: FsEvent) {
    if (event.type === 'ready') { await this.synchronize(); return; }
    if (event.type === 'file-renamed' && this.state.path && (this.state.path === event.oldPath || this.state.path.startsWith(event.oldPath + '/'))) {
      this.syncId++;
      this.update({ path: event.newPath + this.state.path.slice(event.oldPath.length) });
      await this.synchronize();
      return;
    }
    if ((event.type === 'file-changed' || event.type === 'file-deleted') && event.path === this.state.path) {
      if (event.type === 'file-changed' && ((event.origin === this.clientId && event.writeId === this.writeId) || (event.revision === this.state.revision && !this.state.missing))) return;
      // Read authoritative current state: queued delete/add events can be stale.
      await this.synchronize();
    }
  }

  async reload() {
    if (this.state.path) await this.open(this.state.path, true);
  }

  async overwrite() {
    if (!this.state.path || this.state.missing) return;
    if (this.inFlight) await this.inFlight;
    const id = this.documentId;
    try {
      const latest = await this.transport.read(this.state.path);
      if (id !== this.documentId) return;
      this.base = latest.content;
      this.update({ revision: latest.revision, conflict: false, error: null, dirty: this.state.content !== latest.content });
      await this.save();
    } catch (error) { if (id === this.documentId) this.failure(error); }
  }

  private message(error: unknown) { return error instanceof Error ? error.message : strings.session.operationFailed; }
  private failure(error: unknown) {
    clearTimeout(this.timer);
    if (error instanceof ApiError && error.status === 404) this.update({ missing: true, error: strings.session.fileMissing });
    else if (error instanceof ApiError && error.code === 'CONFLICT') this.update({ conflict: true, error: null });
    else this.update({ error: this.message(error) });
  }

  dispose() { clearTimeout(this.timer); this.loadId++; this.syncId++; this.listeners.clear(); }
}
