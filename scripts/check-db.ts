import { ConfigurationError, loadEnv } from '../src/config/env.js';
import { connectDatabase } from '../src/db/client.js';
import { describeDatabaseError } from '../src/lib/database-error.js';

let connection: ReturnType<typeof connectDatabase> | undefined;
try {
  connection = connectDatabase(loadEnv());
  await connection.client`select 1`;
  console.info('Database connection and configured TLS verification succeeded. No application data was changed.');
} catch (error) {
  if (error instanceof ConfigurationError) console.error(error.message);
  else {
    const diagnostic = describeDatabaseError(error);
    console.error(`Database connection check failed [${diagnostic.code}]: ${diagnostic.message}\n${diagnostic.hint}`);
  }
  process.exitCode = 1;
} finally { await connection?.client.end({ timeout: 5 }); }
