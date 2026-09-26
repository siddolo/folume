import type { FileDocument, FsNode, WriteRequest } from '../shared/filesystem-types';
import { strings, formatString } from '../shared/strings';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Folume-Request': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ code: 'HTTP_ERROR', error: formatString(strings.errors.http, { status: response.status }) }));
    throw new ApiError(response.status, error.code, error.error);
  }
  return response.json() as Promise<T>;
}

export const api = {
  tree: () => request<FsNode[]>('/api/files/tree'),
  read: (path: string) => request<FileDocument>(`/api/files/content?path=${encodeURIComponent(path)}`),
  write: (body: WriteRequest) => request<FileDocument>('/api/files/content', 'PUT', body),
  create: (path: string, directory: boolean) => request(directory ? '/api/directories' : '/api/files', 'POST', { path }),
  rename: (oldPath: string, newPath: string) => request('/api/files/rename', 'PATCH', { oldPath, newPath }),
  remove: (path: string) => request('/api/files', 'DELETE', { path }),
};

export function identifier() {
  // getRandomValues also works on HTTP LAN origins where randomUUID is unavailable.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}
