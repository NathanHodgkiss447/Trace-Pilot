import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { ConfigurationError, loadEnv } from '../config/env.js';
import { connectDatabase } from './client.js';
import { describeDatabaseError } from '../lib/database-error.js';

let connection: ReturnType<typeof connectDatabase> | undefined;
try {
  connection = connectDatabase(loadEnv());
  await migrate(connection.db, { migrationsFolder: './src/db/migrations' });
  console.info('Database migrations applied.');
} catch (error) {
  if (error instanceof ConfigurationError) console.error(error.message);
  else {
    const diagnostic = describeDatabaseError(error);
    console.error(`Migration failed [${diagnostic.code}]: ${diagnostic.message}\n${diagnostic.hint}`);
  }
  process.exitCode = 1;
} finally { await connection?.client.end({ timeout: 5 }); }
