import { z } from 'zod';

export const incidentId = z.string().regex(/^INC-\d{4,8}$/).meta({ description: 'Stable fictional incident identifier.', examples: ['INC-1042', 'INC-1043'] });
export const severity = z.enum(['critical', 'high', 'medium', 'low']);
export const level = z.enum(['debug', 'info', 'warn', 'error', 'fatal']);
export const listFilter = z.strictObject({
  service: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(),
  severity: severity.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export const evidenceFilter = z.strictObject({
  service: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(),
  severity: severity.optional(),
  level: level.optional(),
  requestId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
  windowMinutes: z.coerce.number().int().min(5).max(1440).optional(),
});
const text = z.string().min(1).max(3000);
const ids = z.array(z.string().regex(/^(LOG|DEP|RUN)-[A-Za-z0-9-]+$/)).max(100);
export const hypothesisSchema = z.strictObject({
  hypothesis: text,
  explanation: text,
  confidence: z.enum(['high', 'medium', 'low']),
  supporting_evidence_ids: ids,
  contradicting_evidence_ids: ids,
  suggested_verification_steps: z.array(text).min(1).max(8),
});
export const analysisSchema = z.strictObject({
  incidentId,
  summary: text,
  severity,
  observations: z.array(z.strictObject({ description: text, evidence_ids: ids.min(1) })).max(20),
  hypotheses: z.array(hypothesisSchema).min(1).max(5),
  missingEvidence: z.array(text).max(12),
  recommendedActions: z.array(z.strictObject({ action: text, requiresHumanReview: z.boolean() })).min(1).max(10),
  humanReviewRequired: z.boolean(),
});
export type Analysis = z.infer<typeof analysisSchema>;
export type ListFilter = z.infer<typeof listFilter>;
export type EvidenceFilter = z.infer<typeof evidenceFilter>;
