import { describe, expect, it } from 'vitest';
import { PreviewStore } from '../src/repositories/preview.store.js';
import { correlate, EvidenceService } from '../src/services/evidence.service.js';
import { sampleIncidents, exampleAnalysis } from '../src/db/fixtures.js';
import { analysisSchema, evidenceFilter, incidentId, listFilter } from '../src/schemas/domain.js';
import { validateAnalysis } from '../src/lib/evidence-validator.js';
import { verifyBearer } from '../src/lib/auth.js';

const store = new PreviewStore();
const evidence = new EvidenceService(store);
describe('deterministic retrieval and correlation', () => {
  it('filters incidents by service and severity and honors a bounded limit', async () => {
    expect(await store.listIncidents({ service: 'checkout', severity: 'critical', limit: 1 })).toMatchObject([{ id: 'INC-1042' }]);
    expect(await store.listIncidents({ service: 'checkout', severity: 'low', limit: 5 })).toEqual([]);
    expect(await store.listIncidents({ limit: 2 })).toHaveLength(2);
  });
  it('rejects unbounded, fractional and unknown filters', () => {
    for (const limit of [0, 51, -1, 1.5]) expect(listFilter.safeParse({ limit }).success).toBe(false);
    expect(evidenceFilter.safeParse({ windowMinutes: 1441 }).success).toBe(false);
    expect(listFilter.safeParse({ extra: true }).success).toBe(false);
    expect(incidentId.safeParse("INC-1042' OR true--").success).toBe(false);
  });
  it('returns only the requested service and stable evidence IDs', async () => {
    const bundle = await evidence.retrieve('INC-1042');
    expect(bundle.evidenceIds).toContain('DEP-1042');
    expect(bundle.logs.every(l => l.incidentId === bundle.incident.id)).toBe(true);
    expect(bundle.deployments.every(d => d.serviceName === 'checkout')).toBe(true);
    expect(new Set(bundle.evidenceIds).size).toBe(bundle.evidenceIds.length);
  });
  it('correlates a prior deployment, repeated errors and request groups', async () => {
    const bundle = await evidence.retrieve('INC-1042');
    expect(bundle.correlations.nearbyDeployments).toEqual([{ deploymentId: 'DEP-1042', minutesBeforeIncident: 3 }]);
    expect(bundle.correlations.errorCount).toBe(2);
    expect(bundle.correlations.repeatedPatterns[0]?.count).toBe(2);
    expect(bundle.correlations.requestGroups.find(g => g.requestId === 'req-1042-2')?.logIds).toEqual(['LOG-1042-3', 'LOG-1042-4']);
  });
  it('does not describe deployments after onset as preceding it', async () => {
    const bundle = await evidence.retrieve('INC-1042');
    const records = { ...bundle, deployments: bundle.deployments.map(d => ({ ...d, deployedAt: '2026-09-11T10:01:00Z' })) };
    expect(correlate(bundle.incident, records).nearbyDeployments).toEqual([]);
  });
  it('filters logs by level and request ID', async () => {
    const bundle = await evidence.retrieve('INC-1042', { level: 'error', requestId: 'req-1042-2' });
    expect(bundle.logs.map(l => l.id)).toEqual(['LOG-1042-3']);
  });
  it('narrows the time window around onset', async () => {
    const bundle = await evidence.retrieve('INC-1042', { windowMinutes: 5 });
    expect(bundle.logs).toHaveLength(5);
    expect(bundle.selection.windowMinutes).toBe(5);
  });
  it('returns a safe domain error for unknown or mismatched incidents', async () => {
    await expect(evidence.retrieve('INC-9999')).rejects.toMatchObject({ code: 'INCIDENT_NOT_FOUND', statusCode: 404 });
    await expect(evidence.retrieve('INC-1042', { service: 'auth' })).rejects.toMatchObject({ code: 'INCIDENT_NOT_FOUND' });
    await expect(evidence.retrieve('INC-1042', { severity: 'low' })).rejects.toMatchObject({ code: 'INCIDENT_NOT_FOUND' });
  });
  it('represents incomplete operational evidence without inventing deployments', async () => {
    const bundle = await evidence.retrieve('INC-1043');
    expect(bundle.deployments).toEqual([]);
    expect(bundle.incident.description).toContain('missing');
  });
  it('retains untrusted log content as data', async () => {
    const bundle = await evidence.retrieve('INC-1042');
    expect(bundle.logs.some(log => log.message.includes('ignore previous instructions'))).toBe(true);
    expect(bundle.evidenceIds).not.toContain('DEP-fake');
  });
  it('has six unique synthetic cases', () => {
    expect(new Set(sampleIncidents.map(i => i.id)).size).toBe(6);
  });
});
describe('AI schema and citation verification', () => {
  it('accepts the labelled example against actual evidence', async () => {
    expect(validateAnalysis(exampleAnalysis, await evidence.retrieve('INC-1042'))).toEqual(exampleAnalysis);
  });
  it.each(['supporting_evidence_ids', 'contradicting_evidence_ids'] as const)('rejects fabricated %s without deleting it', async key => {
    const invalid = structuredClone(exampleAnalysis);
    invalid.hypotheses[0]![key].push('LOG-fabricated');
    const bundle = await evidence.retrieve('INC-1042');
    expect(() => validateAnalysis(invalid, bundle)).toThrow('outside the supplied bundle');
  });
  it('rejects fabricated observation evidence', async () => {
    const invalid = structuredClone(exampleAnalysis);
    invalid.observations[0]!.evidence_ids.push('DEP-invented');
    const bundle = await evidence.retrieve('INC-1042');
    expect(() => validateAnalysis(invalid, bundle)).toThrow('outside the supplied bundle');
  });
  it('rejects a different incident ID', async () => {
    const bundle = await evidence.retrieve('INC-1042');
    expect(() => validateAnalysis({ ...exampleAnalysis, incidentId: 'INC-9999' }, bundle)).toThrow('different incident');
  });
  it('does not allow the model to change recorded severity', async () => {
    const bundle = await evidence.retrieve('INC-1042');
    expect(() => validateAnalysis({ ...exampleAnalysis, severity: 'low' }, bundle)).toThrow('recorded incident severity');
  });
  it('rejects a citation classified as both supporting and contradicting', async () => {
    const invalid = structuredClone(exampleAnalysis);
    invalid.hypotheses[0]!.contradicting_evidence_ids = ['LOG-1042-2'];
    const bundle = await evidence.retrieve('INC-1042');
    expect(() => validateAnalysis(invalid, bundle)).toThrow('both supporting and contradicting');
  });
  it('allows separate contradictory evidence to preserve uncertainty', async () => {
    const result = structuredClone(exampleAnalysis);
    result.hypotheses[0]!.contradicting_evidence_ids = ['LOG-1042-4'];
    expect(validateAnalysis(result, await evidence.retrieve('INC-1042')).hypotheses[0]?.contradicting_evidence_ids).toContain('LOG-1042-4');
  });
  it('requires operational supporting evidence for medium or high confidence', async () => {
    const invalid = structuredClone(exampleAnalysis);
    invalid.hypotheses[0]!.supporting_evidence_ids = ['RUN-checkout'];
    const bundle = await evidence.retrieve('INC-1042');
    expect(() => validateAnalysis(invalid, bundle)).toThrow('operational supporting evidence');
    invalid.hypotheses[0]!.confidence = 'low';
    expect(validateAnalysis(invalid, bundle).hypotheses[0]?.confidence).toBe('low');
  });
  it('rejects numeric confidence and unknown AI fields', () => {
    const result = structuredClone(exampleAnalysis);
    expect(analysisSchema.safeParse({ ...result, verifiedRootCause: true }).success).toBe(false);
    expect(analysisSchema.safeParse({ ...result, hypotheses: [{ ...result.hypotheses[0], confidence: 0.93 }] }).success).toBe(false);
  });
  it('requires human review regardless of model judgement', async () => {
    const bundle = await evidence.retrieve('INC-1042');
    expect(() => validateAnalysis({ ...exampleAnalysis, humanReviewRequired: false }, bundle)).toThrow('human review');
  });
});
describe('owner bearer tokens', () => {
  it('accepts a valid bearer token', () => { expect(() => verifyBearer('Bearer owner-secret', 'owner-secret')).not.toThrow(); });
  it.each([undefined, '', 'Basic owner-secret', 'Bearer wrong', 'Bearer owner-secret extra'])('denies malformed or incorrect authorization %s', header => {
    expect(() => verifyBearer(header, 'owner-secret')).toThrow('valid bearer token');
  });
  it('fails closed when the owner token is not configured', () => { expect(() => verifyBearer('Bearer anything', undefined)).toThrow(); });
});
