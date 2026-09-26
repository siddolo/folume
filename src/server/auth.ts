import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Config } from './config.js';
import { strings } from '../shared/strings.js';

export function authenticate(config: Config): RequestHandler {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expected = digest(`${config.user}:${config.password}`);
  return (request, response, next) => {
    if (config.authMode === 'proxy') { next(); return; }
    const header = request.headers.authorization ?? '';
    const credential = /^Basic /i.test(header) ? Buffer.from(header.slice(6), 'base64').toString('utf8') : '';
    if (!timingSafeEqual(digest(credential), expected)) {
      response.setHeader('WWW-Authenticate', 'Basic realm="Folume", charset="UTF-8"');
      response.status(401).json({ error: strings.errors.authenticationRequired, code: 'UNAUTHORIZED' });
      return;
    }
    next();
  };
}

export function protectMutations(config: Config): RequestHandler {
  return (request, response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) { next(); return; }
    const origin = request.headers.origin;
    const expected = config.publicOrigin ?? `${request.protocol}://${request.headers.host}`;
    if (request.headers['x-folume-request'] !== '1' || (origin && origin !== expected) || request.headers['sec-fetch-site'] === 'cross-site') {
      response.status(403).json({ error: strings.errors.originNotAllowed, code: 'ORIGIN' });
      return;
    }
    next();
  };
}
