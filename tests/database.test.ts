import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { connectDatabase } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed-data.js';
import { PostgresStore } from '../src/repositories/postgres.store.js';
import { EvidenceService } from '../src/services/evidence.service.js';
import { exampleAnalysis } from '../src/db/fixtures.js';

// Explicitly opt in with a dedicated, disposable test database. Never use DATABASE_URL here.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('real PostgreSQL migrations, persistence and atomic quota', () => {
  const connection = url ? connectDatabase({ DATABASE_URL: url, NODE_ENV: 'test' }) : undefined;
  const store = connection ? new PostgresStore(connection.db) : undefined;
  beforeAll(async () => {
    if (!connection) return;
    await migrate(connection.db, { migrationsFolder: './src/db/migrations' });
    await migrate(connection.db, { migrationsFolder: './src/db/migrations' });
    await seedDatabase(connection.db);
  });
  afterAll(async () => { await connection?.client.end({ timeout: 5 }); });
  it('migrates repeatedly and seeds without duplication', async () => {
    if (!connection || !store) throw new Error('test configuration');
    const before = await store.listIncidents({ limit: 50 });
    await seedDatabase(connection.db);
    expect(await store.listIncidents({ limit: 50 })).toEqual(before);
    expect(before).toHaveLength(6);
  });
  it('enforces foreign keys for source evidence', async () => {
    if (!connection) throw new Error('test configuration');
    await expect(connection.db.execute(sql`insert into application_logs (id, incident_id, service_name, level, message, timestamp)
      values ('LOG-orphan-test', 'INC-99999999', 'test', 'error', 'synthetic test', now())`)).rejects.toThrow();
  });
  it('allows exactly two reservations under concurrent demand and persists results and audits', async () => {
    if (!connection || !store) throw new Error('test configuration');
    // TEST_DATABASE_URL is dedicated to this suite. Reset only its quota counter, never source data.
    await connection.db.execute(sql`delete from daily_usage`);
    const bundle = await new EvidenceService(store).retrieve('INC-1042');
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => store.reserve(bundle, `db-test-${i}`, 'mock-no-paid-calls', 2)));
    const successes = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<PostgresStore['reserve']>>> => result.status === 'fulfilled');
    expect(successes).toHaveLength(2);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(6);
    const first = successes[0]!.value;
    const second = successes[1]!.value;
    const completed = await store.complete(first.id, exampleAnalysis, { inputTokens: 1 }, 'db-test-complete');
    expect((await store.getInvestigation(first.id))?.hypotheses).toEqual(completed.hypotheses);
    expect(completed.status).toBe('completed');
    await expect(store.complete(first.id, exampleAnalysis, {}, 'db-test-again')).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    await store.fail(second.id, 'AI_TIMEOUT', 'db-test-failed');
    expect((await store.getInvestigation(second.id))?.status).toBe('failed');
    const audit = await connection.db.execute(sql`select action from audit_events where resource_id = ${first.id} order by timestamp`);
    expect(audit.map(row => row.action)).toEqual(['investigation.started', 'investigation.completed']);
    // Recreating the repository does not reset database usage.
    const restarted = new PostgresStore(connection.db);
    await expect(restarted.reserve(bundle, 'db-test-restart', 'mock', 2)).rejects.toMatchObject({ code: 'DAILY_QUOTA_EXCEEDED' });
  });
});
