import type { Database } from './client.js';
import { deployments, incidents, logs, runbooks } from './schema.js';
import { sampleDeployments, sampleIncidents, sampleLogs, sampleRunbooks } from './fixtures.js';

export async function seedDatabase(db: Database) {
  await db.transaction(async tx => {
    await tx.insert(incidents).values(sampleIncidents).onConflictDoNothing();
    await tx.insert(logs).values(sampleLogs).onConflictDoNothing();
    await tx.insert(deployments).values(sampleDeployments).onConflictDoNothing();
    await tx.insert(runbooks).values(sampleRunbooks).onConflictDoNothing();
  });
}
