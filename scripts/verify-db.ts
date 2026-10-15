import { sql } from 'drizzle-orm';
import { ConfigurationError, loadEnv } from '../src/config/env.js';
import { connectDatabase } from '../src/db/client.js';
import { describeDatabaseError } from '../src/lib/database-error.js';

let connection: ReturnType<typeof connectDatabase> | undefined;
try {
  connection = connectDatabase(loadEnv());
  const [row] = await connection.db.execute(sql`select
    (select count(*)::int from incidents) as incidents,
    (select count(*)::int from application_logs) as logs,
    (select count(*)::int from application_logs l left join incidents i on l.incident_id = i.id where i.id is null) as orphan_logs,
    (select count(*)::int from pg_constraint where contype = 'f' and conrelid in ('application_logs'::regclass, 'investigations'::regclass)) as evidence_foreign_keys`);
  if (!row || Number(row.incidents) < 6 || Number(row.logs) < 20 || Number(row.orphan_logs) !== 0 || Number(row.evidence_foreign_keys) < 2) {
    console.error('Database verification failed: expected at least six incidents, twenty logs, two foreign keys and no orphan logs. Check migration and seed state in the intended database.');
    process.exitCode = 1;
  } else console.info('Database verified: six or more incidents, related logs and foreign keys exist; no orphan logs.');
} catch (error) {
  if (error instanceof ConfigurationError) console.error(error.message);
  else {
    const diagnostic = describeDatabaseError(error);
    console.error(`Database verification failed [${diagnostic.code}]: ${diagnostic.message}\n${diagnostic.hint}`);
  }
  process.exitCode = 1;
} finally { await connection?.client.end({ timeout: 5 }); }
