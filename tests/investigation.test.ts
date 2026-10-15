import { describe, expect, it, vi } from 'vitest';
import { exampleAnalysis } from '../src/db/fixtures.js';
import { EvidenceService } from '../src/services/evidence.service.js';
import { InvestigationService } from '../src/services/investigation.service.js';
import { AppError } from '../src/lib/errors.js';
import { TestStore, testEnv } from './helpers.js';

function setup(overrides = {}) {
  const store = new TestStore();
  const evidence = new EvidenceService(store);
  const analyze = vi.fn().mockResolvedValue({ analysis: exampleAnalysis, usage: { inputTokens: 100, outputTokens: 100 } });
  const config = { ...testEnv, ENABLE_AI_INVESTIGATIONS: true, OPENAI_API_KEY: 'test-only-not-a-real-key', ...overrides };
  return { store, evidence, analyze, service: new InvestigationService(store, evidence, { analyze }, config) };
}
describe('investigation orchestration', () => {
  it('saves only validated results and returns the persisted response', async () => {
    const { store, service, analyze } = setup();
    const result = await service.analyze('INC-1042', 'req-owner');
    expect(result.status).toBe('completed');
    expect(analyze).toHaveBeenCalledOnce();
    expect(await service.get(result.id)).toEqual(result);
    expect(store.rows.get(result.id)?.evidenceSnapshot.evidenceIds).toEqual(result.evidenceIds);
    expect(store.audits.map(a => a.action)).toEqual(['investigation.started', 'investigation.completed']);
  });
  it('records failure instead of persisting an unsupported hypothesis', async () => {
    const { store, analyze, service } = setup();
    const invalid = structuredClone(exampleAnalysis);
    invalid.hypotheses[0]!.supporting_evidence_ids = ['LOG-made-up'];
    analyze.mockResolvedValue({ analysis: invalid, usage: { inputTokens: 200, outputTokens: 200 } });
    await expect(service.analyze('INC-1042', 'req-owner')).rejects.toMatchObject({ code: 'INVALID_EVIDENCE_REFERENCES' });
    const row = [...store.rows.values()][0]!;
    expect(row.status).toBe('failed');
    expect(row.hypotheses).toBeNull();
    expect(row.usage).toEqual({ inputTokens: 200, outputTokens: 200 });
    expect(row.completedAt).not.toBeNull();
    expect(store.audits.at(-1)?.action).toBe('investigation.failed');
  });
  it('enforces the kill switch before retrieval, quota or a paid call', async () => {
    const { store, service, analyze } = setup({ ENABLE_AI_INVESTIGATIONS: false });
    await expect(service.analyze('INC-1042', 'req')).rejects.toMatchObject({ code: 'AI_DISABLED' });
    expect(store.reserved).toBe(0);
    expect(analyze).not.toHaveBeenCalled();
  });
  it('fails clearly without AI credentials', async () => {
    const { service, analyze } = setup({ OPENAI_API_KEY: undefined });
    await expect(service.analyze('INC-1042', 'req')).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(analyze).not.toHaveBeenCalled();
  });
  it('rejects a depleted quota before calling the provider', async () => {
    const { service, store, analyze } = setup({ MAX_DAILY_INVESTIGATIONS: 0 });
    await expect(service.analyze('INC-1042', 'req')).rejects.toMatchObject({ code: 'DAILY_QUOTA_EXCEEDED' });
    expect(store.audits.at(-1)?.action).toBe('quota.rejected');
    expect(analyze).not.toHaveBeenCalled();
  });
  it('never refunds failed attempts and does not rerun expensive requests automatically', async () => {
    const { service, store, analyze } = setup({ MAX_DAILY_INVESTIGATIONS: 1 });
    analyze.mockRejectedValue(new AppError('AI_TIMEOUT', 'Timed out', 504));
    await expect(service.analyze('INC-1042', 'req')).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    await expect(service.analyze('INC-1042', 'req')).rejects.toMatchObject({ code: 'DAILY_QUOTA_EXCEEDED' });
    expect(store.reserved).toBe(1);
    expect(analyze).toHaveBeenCalledOnce();
  });
  it('does not spend quota on an empty operational evidence package', async () => {
    const { service, store, analyze } = setup();
    vi.spyOn(store, 'evidence').mockResolvedValue({ logs: [], deployments: [], runbooks: [] });
    await expect(service.analyze('INC-1042', 'req')).rejects.toMatchObject({ code: 'INSUFFICIENT_EVIDENCE' });
    expect(store.reserved).toBe(0);
    expect(analyze).not.toHaveBeenCalled();
  });
  it('returns a safe missing-investigation error', async () => {
    await expect(setup().service.get('62cb6ef2-3a7a-4b54-a7a4-95a54e0a8ad8')).rejects.toMatchObject({ code: 'INVESTIGATION_NOT_FOUND' });
  });
  it('prevents completed records from being overwritten', async () => {
    const { service, store } = setup();
    const result = await service.analyze('INC-1042', 'req');
    await expect(store.complete(result.id, exampleAnalysis, {}, 'req')).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    await store.fail(result.id, 'AI_TIMEOUT', 'req');
    expect((await store.getInvestigation(result.id))?.status).toBe('completed');
  });
});
