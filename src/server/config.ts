import { strings, formatString } from '../shared/strings.js';

export interface Config {
  root: string; host: string; port: number; authMode: 'basic' | 'proxy';
  user: string; password: string; publicOrigin?: string;
  polling: boolean; pollInterval: number; maxBytes: number;
}

export function config(env = process.env): Config {
  const number = (name: string, fallback: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(formatString(strings.config.positiveIntegerRequired, { name }));
    return value;
  };
  const authMode = env.AUTH_MODE ?? 'basic';
  if (authMode !== 'basic' && authMode !== 'proxy') throw new Error(strings.config.invalidAuthMode);
  if (authMode === 'basic' && (!env.AUTH_USER || !env.AUTH_PASSWORD || env.AUTH_PASSWORD === 'replace-with-a-long-password')) {
    throw new Error(strings.config.credentialsRequired);
  }
  if (env.AUTH_USER?.includes(':')) throw new Error(strings.config.invalidAuthUser);
  if (env.PUBLIC_ORIGIN && new URL(env.PUBLIC_ORIGIN).origin !== env.PUBLIC_ORIGIN) throw new Error(strings.config.invalidPublicOrigin);
  if (env.WATCH_USE_POLLING && !['true', 'false'].includes(env.WATCH_USE_POLLING)) throw new Error(strings.config.invalidPollingMode);
  return {
    root: env.MARKDOWN_ROOT || './notes', host: env.HOST ?? '127.0.0.1', port: number('PORT', 3000),
    authMode, user: env.AUTH_USER ?? '', password: env.AUTH_PASSWORD ?? '', publicOrigin: env.PUBLIC_ORIGIN,
    polling: env.WATCH_USE_POLLING === 'true', pollInterval: number('WATCH_POLL_INTERVAL', 1500), maxBytes: number('MAX_FILE_BYTES', 5242880),
  };
}
