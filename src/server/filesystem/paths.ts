import path from 'node:path';
import { strings } from '../../shared/strings.js';
import { FsError } from './errors.js';

export const isMarkdown = (name: string) => /\.md$/i.test(name);
export const hidden = (name: string) => name.startsWith('.');

export function relativePath(input: unknown, allowRoot = false): string {
  if (typeof input !== 'string' || (!input && !allowRoot) || input.length > 4096 ||
      /[\\\x00-\x1f\x7f]/.test(input) || path.posix.isAbsolute(input) || /^[a-z]:/i.test(input)) {
    throw new FsError(400, 'INVALID_PATH', strings.errors.relativePathRequired);
  }
  if (input === '' && allowRoot) return '';
  const parts = input.split('/');
  if (parts.some(part => !part || part === '..' || hidden(part))) {
    throw new FsError(400, 'INVALID_PATH', strings.errors.invalidPathSegments);
  }
  const normalized = path.posix.normalize(input);
  if (normalized !== input) throw new FsError(400, 'INVALID_PATH', strings.errors.nonCanonicalPath);
  return normalized;
}

export function markdownPath(input: unknown): string {
  const value = relativePath(input);
  if (!isMarkdown(value)) throw new FsError(400, 'FILE_TYPE', strings.errors.markdownOnly);
  return value;
}
