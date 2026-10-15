import { loadEnv } from '../config/env.js';
import { connectDatabase } from './client.js';
import { seedDatabase } from './seed-data.js';

const { db, client } = connectDatabase(loadEnv());
try {
  await seedDatabase(db);
  console.info('Six synthetic incidents and related evidence seeded idempotently.');
} catch {
  console.error('Seed failed. Check database connectivity and apply migrations first.');
  process.exitCode = 1;
} finally { await client.end({ timeout: 5 }); }
