import type { Env } from '../config/env.js';
import type { Investigation } from '../db/schema.js';
import type { Store } from '../repositories/store.js';
import { AppError, safeError } from '../lib/errors.js';
import { validateAnalysis } from '../lib/evidence-validator.js';
import type { AiAnalyzer } from './ai.service.js';
import type { EvidenceService } from './evidence.service.js';

export function investigationView(row: Investigation) {
  return {
    id: row.id, incidentId: row.incidentId, status: row.status,
    analysis: row.status === 'completed' ? {
      incidentId: row.incidentId, summary: row.summary, severity: row.severity,
      observations: row.observations, hypotheses: row.hypotheses, missingEvidence: row.missingEvidence,
      recommendedActions: row.recommendedActions, humanReviewRequired: row.humanReviewRequired,
    } : null,
    evidenceIds: row.evidenceIds, modelName: row.modelName, usage: row.usage,
    errorCode: row.errorCode, createdAt: row.createdAt, completedAt: row.completedAt,
    disclaimer: 'AI hypotheses require human verification; citations are checked for membership, not semantic truth.',
  };
}
export class InvestigationService {
  constructor(private store: Store, private evidence: EvidenceService, private ai: AiAnalyzer,
    private config: Pick<Env, 'ENABLE_AI_INVESTIGATIONS' | 'OPENAI_MODEL' | 'MAX_DAILY_INVESTIGATIONS' | 'OPENAI_API_KEY'>,
    private reportError: (category: string) => void = () => {}) {}
  async analyze(incidentId: string, requestId: string) {
    if (!this.config.ENABLE_AI_INVESTIGATIONS) throw new AppError('AI_DISABLED', 'Live AI investigations are disabled by the server owner.', 503);
    if (!this.config.OPENAI_API_KEY) throw new AppError('AI_NOT_CONFIGURED', 'Configure an OpenAI API key to enable live investigations.', 503);
    const bundle = await this.evidence.retrieve(incidentId);
    if (!bundle.logs.length && !bundle.deployments.length) throw new AppError('INSUFFICIENT_EVIDENCE', 'No operational evidence is available.', 422);
    let row: Investigation;
    try {
      row = await this.store.reserve(bundle, requestId, this.config.OPENAI_MODEL, this.config.MAX_DAILY_INVESTIGATIONS);
    } catch (error) {
      if (error instanceof AppError && error.code === 'DAILY_QUOTA_EXCEEDED') {
        await this.store.audit({ action: 'quota.rejected', resourceType: 'incident', resourceId: incidentId, requestId });
      }
      throw error;
    }
    let usage: Record<string, number> | undefined;
    try {
      const result = await this.ai.analyze(bundle);
      const { analysis } = result;
      usage = result.usage;
      // Validate at the persistence boundary as well, including injected providers used by tests.
      const verified = validateAnalysis(analysis, bundle);
      return investigationView(await this.store.complete(row.id, verified, usage, requestId));
    } catch (error) {
      const safe = safeError(error);
      try { await this.store.fail(row.id, safe.code, requestId, usage ?? safe.usage); }
      catch { this.reportError('investigation_failure_persistence'); }
      throw safe;
    }
  }
  async get(id: string) {
    const row = await this.store.getInvestigation(id);
    if (!row) throw new AppError('INVESTIGATION_NOT_FOUND', 'Investigation was not found.', 404);
    return investigationView(row);
  }
}
