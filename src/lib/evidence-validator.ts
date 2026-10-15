import { analysisSchema } from '../schemas/domain.js';
import type { Analysis } from '../schemas/domain.js';
import type { EvidenceBundle } from '../services/evidence.service.js';
import { AppError } from './errors.js';

export function validateAnalysis(input: unknown, bundle: EvidenceBundle): Analysis {
  const parsed = analysisSchema.safeParse(input);
  if (!parsed.success) throw new AppError('INVALID_AI_RESPONSE', 'The model response did not satisfy the investigation schema.', 502);
  const result = parsed.data;
  if (result.incidentId !== bundle.incident.id) throw new AppError('INVALID_EVIDENCE_REFERENCES', 'The model referenced a different incident.', 502);
  if (result.severity !== bundle.incident.severity) throw new AppError('INVALID_AI_RESPONSE', 'The model altered the recorded incident severity.', 502);
  const allowed = new Set(bundle.evidenceIds);
  const citations = [...result.observations.flatMap(o => o.evidence_ids), ...result.hypotheses.flatMap(h => [...h.supporting_evidence_ids, ...h.contradicting_evidence_ids])];
  if (citations.some(id => !allowed.has(id))) throw new AppError('INVALID_EVIDENCE_REFERENCES', 'The model cited evidence outside the supplied bundle.', 502);
  for (const hypothesis of result.hypotheses) {
    if (hypothesis.supporting_evidence_ids.some(id => hypothesis.contradicting_evidence_ids.includes(id))) {
      throw new AppError('INVALID_AI_RESPONSE', 'A hypothesis classified the same evidence as both supporting and contradicting.', 502);
    }
    if (hypothesis.confidence !== 'low' && !hypothesis.supporting_evidence_ids.some(id => /^(LOG|DEP)-/.test(id))) {
      throw new AppError('INVALID_AI_RESPONSE', 'Confidence requires operational supporting evidence.', 502);
    }
  }
  // Policy invariant, independent of the model's own safety judgement.
  if (!result.humanReviewRequired) throw new AppError('INVALID_AI_RESPONSE', 'Investigations require human review.', 502);
  return result;
}
