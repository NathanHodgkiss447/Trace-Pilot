import { expect, it } from 'vitest';
import '../src/config/local-env.js';
import { createAnalyzer } from '../src/services/ai.service.js';
import { EvidenceService } from '../src/services/evidence.service.js';
import { PreviewStore } from '../src/repositories/preview.store.js';

// A key alone never triggers payment in npm test. An explicit smoke-test flag is required.
it.skipIf(process.env.TRACEPILOT_LIVE_SMOKE !== 'true' || !process.env.OPENAI_API_KEY)('optional real structured OpenAI response', async () => {
  const bundle = await new EvidenceService(new PreviewStore()).retrieve('INC-1042');
  const analyzer = createAnalyzer(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL ?? 'gpt-4.1-mini', 50000);
  const result = await analyzer.analyze(bundle);
  expect(result.analysis.incidentId).toBe('INC-1042');
  expect(result.analysis.humanReviewRequired).toBe(true);
}, 60000);
