import { randomUUID } from 'node:crypto';
import { PreviewStore } from '../src/repositories/preview.store.js';
import { AppError } from '../src/lib/errors.js';
import type { AuditEvent, Investigation } from '../src/db/schema.js';
import type { EvidenceBundle } from '../src/services/evidence.service.js';
import type { Analysis } from '../src/schemas/domain.js';
import type { Env } from '../src/config/env.js';

export const testEnv: Env = {
  DATABASE_URL: undefined, DATABASE_CA_PATH: undefined, OPENAI_API_KEY: undefined, OPENAI_MODEL: 'gpt-4.1-mini',
  ADMIN_API_TOKEN: 'admin-test-token-with-32-characters-minimum', MCP_BEARER_TOKEN: 'mcp-test-token-with-32-characters-minimum',
  ENABLE_AI_INVESTIGATIONS: false, MAX_DAILY_INVESTIGATIONS: 5, PORT: 3000, NODE_ENV: 'test',
  PUBLIC_BASE_URL: 'http://localhost:3000', EVIDENCE_WINDOW_MINUTES: 60, AI_TIMEOUT_MS: 1000,
};

// Test-only in-memory repository. Production always uses PostgreSQL for writes and quota enforcement.
export class TestStore extends PreviewStore {
  override readonly mode = 'test' as const;
  rows = new Map<string, Investigation>();
  audits: AuditEvent[] = [];
  reserved = 0;
  override async audit(event: AuditEvent) { this.audits.push(event); }
  override async reserve(bundle: EvidenceBundle, requestId: string, model: string, limit: number): Promise<Investigation> {
    if (this.reserved >= limit) throw new AppError('DAILY_QUOTA_EXCEEDED', 'Daily investigation quota reached.', 429);
    this.reserved++;
    const row: Investigation = {
      id: randomUUID(), incidentId: bundle.incident.id, status: 'running', summary: null, severity: null,
      hypotheses: null, observations: null, missingEvidence: null, recommendedActions: null, humanReviewRequired: true,
      evidenceIds: bundle.evidenceIds, evidenceSnapshot: bundle, modelName: model, usage: null, errorCode: null,
      createdAt: new Date().toISOString(), completedAt: null,
    };
    this.rows.set(row.id, row);
    await this.audit({ action: 'investigation.started', resourceType: 'investigation', resourceId: row.id, requestId });
    return row;
  }
  override async complete(id: string, analysis: Analysis, usage: Record<string, number>, requestId: string): Promise<Investigation> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'running') throw new AppError('INVALID_STATUS_TRANSITION', 'Investigation is no longer running.', 409);
    Object.assign(row, { ...analysis, status: 'completed', usage, completedAt: new Date().toISOString() });
    await this.audit({ action: 'investigation.completed', resourceType: 'investigation', resourceId: id, requestId });
    return row;
  }
  override async fail(id: string, code: string, requestId: string, usage?: Record<string, number>) {
    const row = this.rows.get(id);
    if (row?.status === 'running') {
      Object.assign(row, { status: 'failed', errorCode: code, ...(usage ? { usage } : {}), completedAt: new Date().toISOString() });
      await this.audit({ action: 'investigation.failed', resourceType: 'investigation', resourceId: id, requestId });
    }
  }
  override async getInvestigation(id: string) { return this.rows.get(id); }
}
