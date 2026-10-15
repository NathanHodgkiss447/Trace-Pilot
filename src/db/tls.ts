import { readFileSync } from 'node:fs';
import type { Env } from '../config/env.js';

// Inline PEM is suitable for managed hosting; file paths remain convenient locally.
export function databaseTlsOptions(
  env: Pick<Env, 'DATABASE_CA_CERT' | 'DATABASE_CA_PATH' | 'NODE_ENV'>,
  hostname: string,
) {
  const ca = env.DATABASE_CA_CERT ?? (env.DATABASE_CA_PATH ? readFileSync(env.DATABASE_CA_PATH, 'utf8') : undefined);
  const remote = !['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  return remote || env.NODE_ENV === 'production' || ca
    ? { rejectUnauthorized: true as const, ...(ca ? { ca } : {}) }
    : undefined;
}
