import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { OpenAiAnalyzer, systemInstructions } from '../src/services/ai.service.js';
import { EvidenceService } from '../src/services/evidence.service.js';
import { PreviewStore } from '../src/repositories/preview.store.js';
import { exampleAnalysis } from '../src/db/fixtures.js';

const evidence = new EvidenceService(new PreviewStore());
function response(analysis: unknown = exampleAnalysis) {
  return { output_parsed: analysis, status: 'completed', output: [], usage: { input_tokens: 100, output_tokens: 200 } };
}
function setup() {
  const parse = vi.fn().mockResolvedValue(response());
  const client = { responses: { parse } } as unknown as OpenAI;
  return { parse, analyzer: new OpenAiAnalyzer(client, 'gpt-4.1-mini', 1000) };
}
describe('OpenAI Responses API boundary', () => {
  it('requests strict structured output and validates the result', async () => {
    const { parse, analyzer } = setup();
    const result = await analyzer.analyze(await evidence.retrieve('INC-1042'));
    expect(result.analysis).toEqual(exampleAnalysis);
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 200, requests: 1 });
    const [request, options] = parse.mock.calls[0]!;
    expect(request.store).toBe(false);
    expect(request.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(request.tools).toBeUndefined();
    expect(options.maxRetries).toBe(0);
    expect(systemInstructions).toContain('untrusted data');
  });
  it('retries unsupported evidence once with bounded corrective context', async () => {
    const { parse, analyzer } = setup();
    const invalid = structuredClone(exampleAnalysis);
    invalid.hypotheses[0]!.supporting_evidence_ids = ['DEP-fabricated'];
    parse.mockResolvedValueOnce(response(invalid)).mockResolvedValueOnce(response());
    const result = await analyzer.analyze(await evidence.retrieve('INC-1042'));
    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse.mock.calls[1]?.[0].input[1].content).toContain('CORRECTION');
    expect(result.usage.requests).toBe(2);
  });
  it('rejects repeated fabricated citations instead of repairing them silently', async () => {
    const { parse, analyzer } = setup();
    parse.mockResolvedValue(response({ ...exampleAnalysis, incidentId: 'INC-9999' }));
    await expect(analyzer.analyze(await evidence.retrieve('INC-1042'))).rejects.toMatchObject({ code: 'INVALID_EVIDENCE_REFERENCES' });
    expect(parse).toHaveBeenCalledTimes(2);
  });
  it('rejects empty operational evidence before calling OpenAI', async () => {
    const { parse, analyzer } = setup();
    const bundle = await evidence.retrieve('INC-1042');
    await expect(analyzer.analyze({ ...bundle, logs: [], deployments: [] })).rejects.toMatchObject({ code: 'INSUFFICIENT_EVIDENCE' });
    expect(parse).not.toHaveBeenCalled();
  });
  it('handles timeouts with at most one transient retry', async () => {
    const { parse, analyzer } = setup();
    parse.mockRejectedValue(new OpenAI.APIConnectionTimeoutError());
    await expect(analyzer.analyze(await evidence.retrieve('INC-1042'))).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    expect(parse).toHaveBeenCalledTimes(2);
  });
  it('handles provider rate limits with bounded retries', async () => {
    const { parse, analyzer } = setup();
    parse.mockRejectedValue(new OpenAI.APIError(429, { message: 'limited' }, 'limited', new Headers()));
    await expect(analyzer.analyze(await evidence.retrieve('INC-1042'))).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });
    expect(parse).toHaveBeenCalledTimes(2);
  });
  it('recovers once from a transient provider error', async () => {
    const { parse, analyzer } = setup();
    parse.mockRejectedValueOnce(new OpenAI.APIError(503, { message: 'unavailable' }, 'unavailable', new Headers()));
    expect((await analyzer.analyze(await evidence.retrieve('INC-1042'))).analysis.incidentId).toBe('INC-1042');
    expect(parse).toHaveBeenCalledTimes(2);
  });
  it('reports unsupported models safely without retry', async () => {
    const { parse, analyzer } = setup();
    parse.mockRejectedValue(new OpenAI.APIError(400, { message: 'model=secret-path' }, 'model=secret-path', new Headers()));
    await expect(analyzer.analyze(await evidence.retrieve('INC-1042'))).rejects.toMatchObject({ code: 'AI_MODEL_CONFIGURATION' });
    expect(parse).toHaveBeenCalledOnce();
  });
  it('handles incomplete responses without persisting partial content', async () => {
    const { parse, analyzer } = setup();
    parse.mockResolvedValue({ ...response(), status: 'incomplete' });
    await expect(analyzer.analyze(await evidence.retrieve('INC-1042'))).rejects.toMatchObject({ code: 'AI_INCOMPLETE' });
  });
  it('detects refusals explicitly', async () => {
    const { parse, analyzer } = setup();
    parse.mockResolvedValue({ ...response(null), output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Cannot comply' }] }] });
    await expect(analyzer.analyze(await evidence.retrieve('INC-1042'))).rejects.toMatchObject({ code: 'AI_REFUSAL' });
  });
  it('rejects invalid structured or empty parsed responses', async () => {
    const { parse, analyzer } = setup();
    parse.mockResolvedValue(response(null));
    await expect(analyzer.analyze(await evidence.retrieve('INC-1042'))).rejects.toMatchObject({ code: 'INVALID_AI_RESPONSE' });
  });
});
