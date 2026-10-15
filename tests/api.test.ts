import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { exampleAnalysis } from '../src/db/fixtures.js';
import { TestStore, testEnv } from './helpers.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
async function setup(enabled = false) {
  const store = new TestStore();
  const analyze = vi.fn().mockResolvedValue({ analysis: exampleAnalysis, usage: { inputTokens: 100, outputTokens: 200 } });
  const app = await buildApp({ env: { ...testEnv, ENABLE_AI_INVESTIGATIONS: enabled, OPENAI_API_KEY: enabled ? 'test-only' : undefined }, store, ai: { analyze }, logger: false });
  apps.push(app);
  return { app, store, analyze };
}
const auth = { authorization: `Bearer ${testEnv.ADMIN_API_TOKEN}` };
describe('REST API', () => {
  it.each(['/health', '/api/demo/incidents', '/api/demo/incidents/INC-1042', '/api/demo/example-investigation'])('serves %s without a token', async path => {
    const { app, analyze } = await setup();
    const response = await app.inject(path);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ requestId: expect.any(String), metadata: { synthetic: true } });
    expect(analyze).not.toHaveBeenCalled();
  });
  it('labels the static snapshot as hand-authored example data', async () => {
    const { app } = await setup();
    expect((await app.inject('/api/demo/example-investigation')).json().data).toMatchObject({ example: true, generatedLive: false });
  });
  it('serves Swagger UI and schemas with protected operations documented', async () => {
    const { app } = await setup();
    const docs = await app.inject('/docs/');
    expect(docs.statusCode).toBe(200);
    expect(docs.body).toContain('swagger-ui');
    const specification = (await app.inject('/docs/json')).json();
    expect(specification.components.securitySchemes.AdminBearer).toMatchObject({ scheme: 'bearer' });
    expect(specification.paths['/api/investigations'].post.security).toEqual([{ AdminBearer: [] }]);
    expect(specification.paths['/api/demo/incidents'].get.responses['200']).toBeDefined();
  });
  it('redacts public log metadata and request IDs', async () => {
    const { app } = await setup();
    const data = (await app.inject('/api/demo/incidents/INC-1042')).json().data;
    expect(data.evidence.logs.every((l: { requestId: unknown }) => l.requestId === null)).toBe(true);
    expect(data.evidence.logs[0].metadata).toEqual({ synthetic: true });
  });
  it.each([
    '/api/demo/incidents/not-an-id', '/api/demo/incidents?limit=999', '/api/demo/incidents?severity=urgent', '/api/demo/incidents?extra=unknown',
  ])('rejects invalid inputs %s', async path => {
    const { app } = await setup();
    const response = await app.inject(path);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'INVALID_INPUT' }, requestId: expect.any(String) });
    expect(response.body).not.toContain('stack');
  });
  it('returns a consistent missing-incident error', async () => {
    const { app } = await setup();
    expect((await app.inject('/api/demo/incidents/INC-9999')).json()).toMatchObject({ error: { code: 'INCIDENT_NOT_FOUND' } });
  });
  it.each([undefined, 'Bearer wrong', `Bearer ${testEnv.MCP_BEARER_TOKEN}`])('denies missing, invalid or cross-interface tokens', async authorization => {
    const { app, store, analyze } = await setup();
    const headers = authorization ? { authorization } : {};
    for (const url of ['/api/incidents/INC-1042/evidence', '/api/investigations/62cb6ef2-3a7a-4b54-a7a4-95a54e0a8ad8']) {
      expect((await app.inject({ url, headers })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url: '/api/investigations', headers, payload: { incidentId: 'INC-1042' } })).statusCode).toBe(401);
    expect(analyze).not.toHaveBeenCalled();
    expect(store.audits.some(a => a.action === 'authentication.failed')).toBe(true);
  });
  it('returns complete evidence to the authenticated owner', async () => {
    const { app } = await setup();
    const response = await app.inject({ url: '/api/incidents/INC-1042/evidence?level=error', headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.logs).toHaveLength(2);
  });
  it('rejects paid calls while the kill switch is off', async () => {
    const { app, analyze } = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/investigations', headers: auth, payload: { incidentId: 'INC-1042' } });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('AI_DISABLED');
    expect(analyze).not.toHaveBeenCalled();
  });
  it('throttles repeated analysis requests with a safe HTTP 429', async () => {
    const { app, analyze } = await setup();
    for (let i = 0; i < 10; i++) {
      expect((await app.inject({ method: 'POST', url: '/api/investigations', headers: auth, payload: { incidentId: 'INC-1042' } })).statusCode).toBe(503);
    }
    const rejected = await app.inject({ method: 'POST', url: '/api/investigations', headers: auth, payload: { incidentId: 'INC-1042' } });
    expect(rejected.statusCode).toBe(429);
    expect(rejected.json().error.code).toBe('RATE_LIMITED');
    expect(analyze).not.toHaveBeenCalled();
  });
  it('validates analysis input and rejects extra fields', async () => {
    const { app } = await setup();
    for (const payload of [{}, { incidentId: 'INC-1042', model: 'expensive' }, { incidentId: '../secret' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/investigations', headers: auth, payload })).statusCode).toBe(400);
    }
  });
  it('creates and retrieves a persisted investigation with the shared service', async () => {
    const { app } = await setup(true);
    const response = await app.inject({ method: 'POST', url: '/api/investigations', headers: auth, payload: { incidentId: 'INC-1042' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe('completed');
    const saved = await app.inject({ url: response.headers.location as string, headers: auth });
    expect(saved.json().data).toEqual(response.json().data);
  });
  it('does not disclose database errors', async () => {
    const { app, store } = await setup();
    vi.spyOn(store, 'listIncidents').mockRejectedValue(new Error('postgresql://secret:password@private/db INTERNAL STACK'));
    const response = await app.inject('/api/demo/incidents');
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toMatch(/password|postgresql|STACK/);
  });
  it('rejects oversized bodies before the service executes', async () => {
    const { app, analyze } = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/investigations', headers: auth, payload: { incidentId: 'x'.repeat(40000) } });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('BODY_TOO_LARGE');
    expect(analyze).not.toHaveBeenCalled();
  });
  it('generates server-owned request IDs', async () => {
    const { app } = await setup();
    const response = await app.inject({ url: '/health', headers: { 'x-request-id': 'user-controlled' } });
    expect(response.json().requestId).not.toBe('user-controlled');
  });
  it('returns consistent route-not-found errors and blocks unregistered methods', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'DELETE', url: '/api/demo/incidents' })).json().error.code).toBe('NOT_FOUND');
  });
});
