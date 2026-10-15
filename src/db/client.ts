import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import type { Env } from '../config/env.js';
import { ConfigurationError } from '../config/env.js';
import { databaseTlsOptions } from './tls.js';

export function connectDatabase(env: Pick<Env, 'DATABASE_URL' | 'DATABASE_CA_PATH' | 'DATABASE_CA_CERT' | 'NODE_ENV'>) {
  if (!env.DATABASE_URL) throw new ConfigurationError('DATABASE_URL is required for database commands.');
  const hostname = new URL(env.DATABASE_URL).hostname;
  const client = postgres(env.DATABASE_URL, {
    max: 5, idle_timeout: 20, connect_timeout: 8, prepare: false,
    connection: { statement_timeout: 10000, application_name: 'tracepilot' },
    ssl: databaseTlsOptions(env, hostname),
  });
  return { db: drizzle(client, { schema }), client };
}
export type Database = ReturnType<typeof connectDatabase>['db'];
