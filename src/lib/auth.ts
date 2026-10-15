import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';

export function verifyBearer(header: string | undefined, expected: string | undefined) {
  const provided = /^Bearer ([^\s]+)$/i.exec(header ?? '')?.[1];
  if (!expected || !provided || !timingSafeEqual(createHash('sha256').update(provided).digest(), createHash('sha256').update(expected).digest())) {
    throw new AppError('UNAUTHORIZED', 'A valid bearer token is required.', 401);
  }
}
