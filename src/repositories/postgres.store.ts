import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { auditEvents, dailyUsage, deployments, incidents, investigations, logs, runbooks } from '../db/schema.js';
import type { AuditEvent, Incident } from '../db/schema.js';
import type { Analysis, EvidenceFilter, ListFilter } from '../schemas/domain.js';
import type { EvidenceBundle } from '../services/evidence.service.js';
import type { Store } from './store.js';
import { AppError } from '../lib/errors.js';

export class PostgresStore implements Store {
  readonly mode = 'postgres' as const;
  constructor(private db: Database) {}
  async health() { await this.db.execute(sql`select 1 from ${incidents} limit 1`); }
  listIncidents(filter: ListFilter) {
    return this.db.select().from(incidents).where(and(
      filter.service ? eq(incidents.serviceName, filter.service) : undefined,
      filter.severity ? eq(incidents.severity, filter.severity) : undefined,
    )).orderBy(desc(incidents.startedAt), asc(incidents.id)).limit(filter.limit);
  }
  async getIncident(id: string) { return (await this.db.select().from(incidents).where(eq(incidents.id, id)).limit(1))[0]; }
  async evidence(incident: Incident, filter: EvidenceFilter, windowMinutes: number) {
    const start = new Date(Date.parse(incident.startedAt) - windowMinutes * 60000).toISOString();
    const end = new Date(Date.parse(incident.startedAt) + windowMinutes * 60000).toISOString();
    const [logRows, deploymentRows, runbookRows] = await Promise.all([
      this.db.select().from(logs).where(and(eq(logs.incidentId, incident.id), eq(logs.serviceName, incident.serviceName),
        gte(logs.timestamp, start), lte(logs.timestamp, end),
        filter.level ? eq(logs.level, filter.level) : undefined, filter.requestId ? eq(logs.requestId, filter.requestId) : undefined,
      )).orderBy(asc(logs.timestamp), asc(logs.id)).limit(100),
      this.db.select().from(deployments).where(and(eq(deployments.serviceName, incident.serviceName),
        eq(deployments.environment, 'production-simulation'), gte(deployments.deployedAt, start), lte(deployments.deployedAt, end),
      )).orderBy(desc(deployments.deployedAt), asc(deployments.id)).limit(10),
      this.db.select().from(runbooks).where(eq(runbooks.serviceName, incident.serviceName)).orderBy(asc(runbooks.id)).limit(5),
    ]);
    return { logs: logRows, deployments: deploymentRows, runbooks: runbookRows };
  }
  async audit(event: AuditEvent) { await this.db.insert(auditEvents).values(event); }
  async reserve(bundle: EvidenceBundle, requestId: string, model: string, dailyLimit: number) {
    if (dailyLimit <= 0) throw new AppError('DAILY_QUOTA_EXCEEDED', 'Daily investigation quota reached.', 429);
    return this.db.transaction(async tx => {
      // PostgreSQL arbitrates concurrent instances. UTC day comes from the database, not a process clock.
      const day = sql`(current_timestamp AT TIME ZONE 'UTC')::date`;
      const quota = await tx.insert(dailyUsage).values({ day, count: 1 }).onConflictDoUpdate({
        target: dailyUsage.day, set: { count: sql`${dailyUsage.count} + 1` },
        setWhere: sql`${dailyUsage.count} < ${dailyLimit}`,
      }).returning();
      if (!quota.length) throw new AppError('DAILY_QUOTA_EXCEEDED', 'Daily investigation quota reached.', 429);
      const [row] = await tx.insert(investigations).values({
        incidentId: bundle.incident.id, evidenceIds: bundle.evidenceIds, evidenceSnapshot: bundle, modelName: model,
      }).returning();
      if (!row) throw new AppError('PERSISTENCE_ERROR', 'Investigation could not be started.');
      await tx.insert(auditEvents).values({ action: 'investigation.started', resourceType: 'investigation', resourceId: row.id, requestId,
        metadata: { model, evidenceCount: bundle.evidenceIds.length, quotaReserved: true } });
      return row;
    });
  }
  async complete(id: string, analysis: Analysis, usage: Record<string, number>, requestId: string) {
    return this.db.transaction(async tx => {
      const [row] = await tx.update(investigations).set({
        status: 'completed', summary: analysis.summary, severity: analysis.severity,
        hypotheses: analysis.hypotheses, observations: analysis.observations, missingEvidence: analysis.missingEvidence,
        recommendedActions: analysis.recommendedActions, humanReviewRequired: true,
        usage, completedAt: new Date().toISOString(),
      }).where(and(eq(investigations.id, id), eq(investigations.status, 'running'))).returning();
      if (!row) throw new AppError('INVALID_STATUS_TRANSITION', 'Investigation is no longer running.', 409);
      await tx.insert(auditEvents).values({ action: 'investigation.completed', resourceType: 'investigation', resourceId: id, requestId, metadata: { model: row.modelName, usage } });
      return row;
    });
  }
  async fail(id: string, code: string, requestId: string, usage?: Record<string, number>) {
    await this.db.transaction(async tx => {
      const rows = await tx.update(investigations).set({ status: 'failed', errorCode: code, usage, completedAt: new Date().toISOString() })
        .where(and(eq(investigations.id, id), eq(investigations.status, 'running'))).returning({ id: investigations.id });
      if (rows.length) await tx.insert(auditEvents).values({ action: 'investigation.failed', resourceType: 'investigation', resourceId: id, requestId, metadata: { code, ...(usage ? { usage } : {}) } });
    });
  }
  async getInvestigation(id: string) { return (await this.db.select().from(investigations).where(eq(investigations.id, id)).limit(1))[0]; }
}
