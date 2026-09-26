import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FsEvent, FsNode } from '../shared/filesystem-types';
import { strings, formatString } from '../shared/strings';
import { api } from './api';
import { DocumentSession } from './document-session';
import { preference, setPreference } from './preferences';
import { FileTree } from '../components/FileTree/FileTree';
import { MarkdownEditor } from '../components/MarkdownEditor/MarkdownEditor';

function urlPath() { return new URL(location.href).searchParams.get('file'); }
function setUrl(path: string | null, replace = false) {
  const url = new URL(location.href);
  if (path) url.searchParams.set('file', path); else url.searchParams.delete('file');
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
}

export function App() {
  const [session] = useState(() => new DocumentSession(api));
  const document = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [tree, setTree] = useState<FsNode[]>([]);
  const [selected, setSelected] = useState<FsNode | null>(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [watcherAvailable, setWatcherAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState(false);
  const [keepLocal, setKeepLocal] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => preference('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [width, setWidth] = useState(() => Math.min(480, Math.max(180, Number(preference('width', 270)) || 270)));
  const treeRequest = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++treeRequest.current;
    try { const next = await api.tree(); if (request === treeRequest.current) setTree(next); }
    catch (error) { setError((error as Error).message); }
  }, []);

  const open = useCallback(async (path: string, fromHistory = false) => {
    const state = session.getSnapshot();
    if (state.path === path) return;
    const discard = state.dirty || state.missing || state.conflict;
    if (discard && !confirm(strings.dialogs.discardLocal)) {
      if (fromHistory) setUrl(state.path, true);
      return;
    }
    if (await session.open(path, discard)) {
      setSelected({ type: 'file', path, name: path.split('/').at(-1)! });
      setKeepLocal(false);
      if (!fromHistory) setUrl(path);
    } else if (fromHistory) setUrl(session.getSnapshot().path, true);
  }, [session]);

  useEffect(() => {
    void refresh();
    const initial = urlPath();
    if (initial) void open(initial, true);
    const events = new EventSource('/api/events');
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.onmessage = message => {
      const event = JSON.parse(message.data) as FsEvent;
      if (event.type === 'tree-changed' || event.type === 'ready' || event.type === 'file-renamed') void refresh();
      if (event.type === 'watcher-status') setWatcherAvailable(event.available);
      void session.event(event).then(() => {
        if (event.type === 'file-renamed') {
          setUrl(session.getSnapshot().path, true);
          setSelected(previous => previous && (previous.path === event.oldPath || previous.path.startsWith(event.oldPath + '/'))
            ? { ...previous, path: event.newPath + previous.path.slice(event.oldPath.length), name: (event.newPath + previous.path.slice(event.oldPath.length)).split('/').at(-1)! } : previous);
        }
      });
    };
    const pop = () => { const path = urlPath(); if (path) void open(path, true); else setUrl(session.getSnapshot().path, true); };
    const unload = (event: BeforeUnloadEvent) => {
      const state = session.getSnapshot();
      if (state.dirty || state.saving || state.missing || state.conflict) { event.preventDefault(); event.returnValue = ''; }
    };
    const keys = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void session.save(); }
    };
    const focus = () => { void refresh(); void session.synchronize(); };
    window.addEventListener('popstate', pop); window.addEventListener('beforeunload', unload); window.addEventListener('keydown', keys); window.addEventListener('focus', focus);
    return () => {
      events.close(); session.dispose();
      window.removeEventListener('popstate', pop); window.removeEventListener('beforeunload', unload); window.removeEventListener('keydown', keys); window.removeEventListener('focus', focus);
    };
  }, [open, refresh, session]);

  useEffect(() => { window.document.documentElement.dataset.theme = theme; setPreference('theme', theme); }, [theme]);
  useEffect(() => { setPreference('width', width); }, [width]);
  useEffect(() => { setKeepLocal(false); }, [document.conflict, document.missing]);

  const operation = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); await refresh(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  const create = (directory: boolean) => {
    const parent = selected?.type === 'directory' ? selected.path : selected?.path.split('/').slice(0, -1).join('/') ?? '';
    const path = prompt(directory ? strings.dialogs.newDirectoryPath : strings.dialogs.newFilePath, `${parent ? parent + '/' : ''}${directory ? strings.dialogs.defaultDirectoryName : strings.dialogs.defaultFileName}`);
    if (path) void operation(async () => { await api.create(path, directory); if (!directory) await open(path); });
  };
  const rename = () => {
    if (!selected) return;
    const oldPath = selected.path;
    const newPath = prompt(strings.dialogs.renamePath, oldPath);
    if (newPath && newPath !== oldPath) void operation(async () => {
      // Finish writes before moving their destination. Conflicted local text remains in memory.
      await session.save();
      await api.rename(oldPath, newPath);
      await session.event({ type: 'file-renamed', oldPath, newPath });
      setUrl(session.getSnapshot().path, true);
      setSelected({ ...selected, path: newPath, name: newPath.split('/').at(-1)! });
    });
  };
  const remove = () => {
    if (!selected) return;
    if (confirm(formatString(selected.type === 'directory' ? strings.dialogs.deleteDirectory : strings.dialogs.deleteFile, { path: selected.path }))) {
      void operation(async () => { await session.save(); await api.remove(selected.path); await session.synchronize(); setSelected(null); });
    }
  };
  const status = document.conflict ? 'conflict' : document.error || document.missing ? 'error' : document.saving ? 'saving' : document.dirty ? 'modified' : 'saved';

  return <div className="app-shell" style={{ '--sidebar-width': `${width}px` } as React.CSSProperties}>
    <aside className="sidebar" aria-label={strings.sidebar.label}>
      <div className="brand"><span className="brand-mark">{strings.brand.mark}</span><div><strong>{strings.brand.name}</strong><small>{strings.brand.tagline}</small></div></div>
      <div className="sidebar-actions">
        <button title={strings.sidebar.newFile} aria-label={strings.sidebar.newFile} disabled={busy} onClick={() => create(false)}>{strings.sidebar.newFileButton}</button>
        <button title={strings.sidebar.newDirectory} aria-label={strings.sidebar.newDirectory} disabled={busy} onClick={() => create(true)}>{strings.sidebar.newDirectoryButton}</button>
      </div>
      <button className={`root-row ${!selected ? 'selected' : ''}`} onClick={() => setSelected(null)}>⌂ {strings.sidebar.allFiles} <span>{tree.length}</span></button>
      <div className="tree-scroll"><FileTree nodes={tree} current={document.path} selected={selected?.path ?? ''} onSelect={setSelected} onOpen={path => { void open(path); }} />
        {!tree.length && <p className="muted tree-empty">{strings.sidebar.empty}</p>}</div>
      <div className="selection-actions"><span title={selected?.path}>{selected?.name ?? strings.sidebar.rootDirectory}</span>
        <button disabled={!selected || busy} onClick={rename} title={strings.sidebar.renameSelection} aria-label={strings.sidebar.renameSelection}>✎</button>
        <button disabled={!selected || busy} onClick={remove} title={strings.sidebar.deleteSelection} aria-label={strings.sidebar.deleteSelection}>×</button>
      </div>
      <div className="sidebar-footer"><span className={`connection ${connected && watcherAvailable ? 'online' : ''}`}>{connected ? watcherAvailable ? strings.connection.live : strings.connection.watcherOffline : strings.connection.reconnecting}</span>
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={strings.sidebar.changeTheme} title={strings.sidebar.changeTheme}>{theme === 'light' ? '☾' : '☀'}</button></div>
    </aside>
    <div className="resize-handle" role="separator" aria-label={strings.sidebar.resizeLabel} aria-orientation="vertical" aria-valuenow={width} aria-valuemin={180} aria-valuemax={480} tabIndex={0}
      onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setWidth(value => Math.min(480, Math.max(180, value + (event.key === 'ArrowLeft' ? -20 : 20)))); } }}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(Math.min(480, Math.max(180, event.clientX))); }}
      onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); }} />
    <main className="workspace">
      <header className="document-header"><div className="breadcrumb" title={document.path ?? ''}>{document.path ?? strings.workspace.title}{document.loading && <small> · {strings.workspace.opening}</small>}</div>
        {document.path && <><span className={`save-status status-${status}`} role="status">{strings.saveStatus[status]}</span>
          <button onClick={() => { void session.save(); }} disabled={!document.dirty || document.saving || document.conflict || document.missing} title={strings.workspace.saveTitle}>{strings.workspace.save}</button>
          <button className={source ? 'active' : ''} onClick={() => setSource(value => !value)} aria-pressed={source} title={strings.workspace.toggleSource}>{source ? strings.workspace.visual : strings.workspace.source}</button></>}
      </header>
      {error && <div className="notice error" role="alert">{error}<button onClick={() => setError('')} aria-label={strings.workspace.closeError}>×</button></div>}
      {(!connected || !watcherAvailable) && <div className="notice">{connected ? strings.connection.watcherUnavailable : strings.connection.interrupted}<button onClick={() => { void refresh(); void session.synchronize(); }}>{strings.connection.checkDisk}</button></div>}
      {(document.conflict || document.error || document.missing) && <div className="notice conflict" role="alert">
        <div><strong>{document.conflict ? strings.conflict.diskChanged : document.error}</strong><p>{keepLocal ? strings.conflict.localKept : strings.conflict.localPreserved}</p></div>
        <div className="notice-actions">
          <button onClick={() => setKeepLocal(true)}>{strings.conflict.keepLocal}</button>
          <button onClick={() => { if (confirm(strings.dialogs.reload)) void session.reload(); }}>{strings.conflict.reload}</button>
          {document.conflict && !document.missing && <button onClick={() => { if (confirm(strings.dialogs.overwrite)) void session.overwrite(); }}>{strings.conflict.overwrite}</button>}
          {!document.conflict && !document.missing && <button onClick={() => { void session.save(); }}>{strings.conflict.retrySave}</button>}
          <button onClick={() => {
            const link = window.document.createElement('a');
            const url = URL.createObjectURL(new Blob([document.content], { type: 'text/markdown;charset=utf-8' }));
            link.href = url; link.download = document.path?.split('/').at(-1) ?? strings.conflict.downloadFilename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>{strings.conflict.download}</button>
        </div>
      </div>}
      {document.path ? source
        ? <textarea className="source-editor" aria-label={strings.workspace.sourceEditorLabel} spellCheck={false} value={document.content} onChange={event => session.edit(event.target.value)} />
        : <MarkdownEditor key={`${document.editorVersion}:${document.path}`} content={document.content} path={document.path} onChange={content => session.edit(content)} onOpen={path => { void open(path); }} />
        : <div className="empty-state"><span className="empty-mark">{strings.brand.mark}</span><h1>{strings.workspace.emptyTitle}</h1><p>{strings.workspace.emptyDescription}</p><button onClick={() => create(false)}>{strings.workspace.createNote}</button></div>}
      <footer className="editor-footer"><span>{document.path ? strings.workspace.documentFormat : strings.workspace.filesystemFirst}</span><span>{document.path ? strings.workspace.shortcuts : strings.workspace.emptyFooter}</span></footer>
    </main>
  </div>;
}
