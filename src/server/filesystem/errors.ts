import { strings } from '../../shared/strings.js';

export class FsError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function publicError(error: unknown): FsError {
  if (error instanceof FsError) return error;
  const code = (error as NodeJS.ErrnoException)?.code;
  switch (code) {
    case 'ENOENT': return new FsError(404, 'NOT_FOUND', strings.errors.notFound);
    case 'EACCES': case 'EPERM': return new FsError(403, 'PERMISSION', strings.errors.permissionDenied);
    case 'ELOOP': case 'ENOTDIR': return new FsError(400, 'UNSAFE_PATH', strings.errors.unsafePath);
    case 'EEXIST': case 'ENOTEMPTY': return new FsError(409, 'EXISTS', strings.errors.destinationExists);
    case 'ENOSPC': return new FsError(507, 'NO_SPACE', strings.errors.noSpace);
    default: return new FsError(500, 'IO_ERROR', strings.errors.filesystemFailed);
  }
}
