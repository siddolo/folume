/** A relative reference is resolved against the note, never against the application URL. */
export function localReference(reference: string, documentPath: string): { path: string; hash: string } | null {
  if (!reference || /^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith('//') || /[\\\x00-\x1f]/.test(reference)) return null;
  try {
    const root = new URL('https://notes.invalid/');
    const base = new URL(documentPath.split('/').map(encodeURIComponent).join('/'), root);
    const url = new URL(reference, base);
    const path = decodeURIComponent(url.pathname).slice(1);
    if (!path || path.split('/').some(part => part.startsWith('.'))) return null;
    return { path, hash: url.hash };
  } catch { return null; }
}

export function imageSource(reference: string, documentPath: string) {
  if (/^https?:\/\//i.test(reference)) return reference;
  const local = localReference(reference, documentPath);
  return local ? `/api/assets?path=${encodeURIComponent(local.path)}` : '';
}
