import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

// Node 24 has native .env support. Already-set environment variables take precedence.
if (existsSync('.env')) {
  try { loadEnvFile('.env'); }
  catch { throw new Error('Unable to read the local .env file.'); }
}
