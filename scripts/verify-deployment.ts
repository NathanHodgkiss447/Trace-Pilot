import '../src/config/local-env.js';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const base = process.env.PUBLIC_BASE_URL;
if (!base) throw new Error('Set PUBLIC_BASE_URL to the actual deployed origin.');
async function check(path: string, expected: number, init?: RequestInit) {
  const timeout = path === '/api/investigations' && init?.method === 'POST' ? 60000 : 15000;
  const response = await fetch(new URL(path, base), { ...init, signal: AbortSignal.timeout(timeout) });
  assert.equal(response.status, expected, `${path} status`);
  return response;
}
for (const path of ['/health', '/docs/', '/api/demo/incidents', '/api/demo/example-investigation']) await check(path, 200);
const health = await (await check('/health', 200)).json() as { data: { aiEnabled: boolean; database: string } };
assert.equal(health.data.database, 'postgres');
if (process.env.ALLOW_AI_ENABLED !== 'true') assert.equal(health.data.aiEnabled, false, 'Verify security before enabling paid AI.');
for (const authorization of [undefined, 'Bearer invalid-token']) {
  const headers: Record<string, string> = authorization ? { authorization } : {};
  await check('/api/incidents/INC-1042/evidence', 401, { headers });
  await check('/api/investigations', 401, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{"incidentId":"INC-1042"}' });
  await check('/mcp', 401, { method: 'POST', headers });
}
const admin = process.env.ADMIN_API_TOKEN;
const mcpToken = process.env.MCP_BEARER_TOKEN;
if (!admin || !mcpToken) throw new Error('Set both owner tokens locally to verify valid-token access.');
await check('/api/incidents/INC-1042/evidence', 200, { headers: { authorization: `Bearer ${admin}` } });
const client = new Client({ name: 'tracepilot-deployment-verifier', version: '1.0.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', base), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }));
  assert.equal((await client.listTools()).tools.length, 4);
  const context = await client.callTool({ name: 'get_incident_context', arguments: { incidentId: 'INC-1042' } });
  assert.ok(!context.isError && context.structuredContent);
  if (process.env.VERIFY_LIVE_AI === 'true') {
    const created = await (await check('/api/investigations', 200, { method: 'POST', headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }, body: '{"incidentId":"INC-1042"}' })).json() as { data: { id: string; status: string; evidenceIds: string[] } };
    assert.equal(created.data.status, 'completed');
    assert.ok(created.data.evidenceIds.length);
    await check(`/api/investigations/${created.data.id}`, 200, { headers: { authorization: `Bearer ${admin}` } });
    const saved = await client.callTool({ name: 'get_investigation', arguments: { investigationId: created.data.id } });
    assert.ok(!saved.isError && saved.structuredContent);
    console.info('One paid investigation completed and was retrieved through REST and MCP.');
  }
} finally { await client.close(); }
console.info('Public routes, database mode, token authentication and official MCP client checks passed.');
