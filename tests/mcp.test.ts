import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { exampleAnalysis } from '../src/db/fixtures.js';
import { investigationSchema } from '../src/schemas/api.js';
import { TestStore, testEnv } from './helpers.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup(enabled = false) {
  const store = new TestStore();
  const analyze = vi.fn().mockResolvedValue({ analysis: exampleAnalysis, usage: {} });
  const app = await buildApp({ env: { ...testEnv, ENABLE_AI_INVESTIGATIONS: enabled, OPENAI_API_KEY: enabled ? 'test-only' : undefined }, store, ai: { analyze }, logger: false });
  cleanup.push(() => app.close());
  await app.ready();
  return { app, store, analyze };
}
async function connect(app: FastifyInstance, authorization = `Bearer ${testEnv.MCP_BEARER_TOKEN}`) {
  const client = new Client({ name: 'tracepilot-integration-test', version: '1.0.0' });
  cleanup.push(() => client.close());
  // Official client + real HTTP transport, with an injection-backed fetch adapter.
  // This exercises the protocol without requiring sandbox socket permissions.
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3000/mcp'), {
    requestInit: { headers: { authorization } },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const headers = Object.fromEntries(request.headers);
      const body = await request.text();
      const result = await app.inject({ method: request.method as 'POST' | 'GET' | 'DELETE', url: new URL(request.url).pathname, headers: { ...headers, host: 'localhost:3000' }, ...(body ? { payload: body } : {}) });
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(result.headers)) {
        if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : String(value));
      }
      return new Response([204, 205, 304].includes(result.statusCode) ? null : result.body, { status: result.statusCode, headers: responseHeaders });
    },
  });
  await client.connect(transport);
  return client;
}
describe('official MCP client integration', () => {
  it('initializes and discovers four tools with input and output schemas', async () => {
    const { app } = await setup();
    const client = await connect(app);
    expect(client.getServerVersion()?.name).toBe('tracepilot');
    const tools = (await client.listTools()).tools;
    expect(tools.map(t => t.name).sort()).toEqual(['analyze_incident', 'get_incident_context', 'get_investigation', 'list_incidents']);
    expect(tools.every(t => t.inputSchema.type === 'object' && t.outputSchema?.type === 'object')).toBe(true);
    expect(tools.find(t => t.name === 'analyze_incident')?.annotations?.idempotentHint).toBe(false);
  });
  it('calls read tools and records a tool audit', async () => {
    const { app, store } = await setup();
    const client = await connect(app);
    const listed = await client.callTool({ name: 'list_incidents', arguments: { service: 'checkout', limit: 1 } });
    expect(listed.isError).not.toBe(true);
    expect(listed.structuredContent).toMatchObject({ data: [{ id: 'INC-1042' }] });
    const context = await client.callTool({ name: 'get_incident_context', arguments: { incidentId: 'INC-1042' } });
    expect(context.structuredContent).toMatchObject({ data: { incident: { id: 'INC-1042' }, evidenceIds: expect.arrayContaining(['DEP-1042']) } });
    expect(store.audits.some(e => e.action === 'mcp.tool_invoked')).toBe(true);
  });
  it('rejects invalid arguments through the SDK', async () => {
    const { app } = await setup();
    const client = await connect(app);
    const result = await client.callTool({ name: 'get_incident_context', arguments: { incidentId: '../../secrets' } });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.type).toBe('text');
  });
  it('returns domain failures as tool errors, with no database details', async () => {
    const { app } = await setup();
    const client = await connect(app);
    const result = await client.callTool({ name: 'get_incident_context', arguments: { incidentId: 'INC-9999' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('INCIDENT_NOT_FOUND');
  });
  it('applies the kill switch to MCP analysis', async () => {
    const { app, analyze } = await setup();
    const client = await connect(app);
    const result = await client.callTool({ name: 'analyze_incident', arguments: { incidentId: 'INC-1042' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('AI_DISABLED');
    expect(analyze).not.toHaveBeenCalled();
  });
  it('uses the shared service to analyze and retrieve persisted results', async () => {
    const { app } = await setup(true);
    const client = await connect(app);
    const result = await client.callTool({ name: 'analyze_incident', arguments: { incidentId: 'INC-1042' } });
    expect(result.isError).not.toBe(true);
    const created = z.object({ data: investigationSchema }).parse(result.structuredContent).data;
    const id = created.id;
    const saved = await client.callTool({ name: 'get_investigation', arguments: { investigationId: id } });
    expect(z.object({ data: investigationSchema }).parse(saved.structuredContent).data).toEqual(created);
  });
  it.each(['Bearer wrong', `Bearer ${testEnv.ADMIN_API_TOKEN}`])('rejects invalid and REST-only tokens before initialization', async token => {
    const { app } = await setup();
    await expect(connect(app, token)).rejects.toThrow();
  });
  it.each(['GET', 'POST', 'DELETE', 'OPTIONS'] as const)('protects unauthenticated %s before discovery or transport work', async method => {
    const { app } = await setup();
    expect((await app.inject({ method, url: '/mcp' })).statusCode).toBe(401);
  });
  it('blocks DNS rebinding and unapproved browser origins', async () => {
    const { app } = await setup();
    const authorization = `Bearer ${testEnv.MCP_BEARER_TOKEN}`;
    expect((await app.inject({ method: 'POST', url: '/mcp', headers: { authorization, host: 'evil.example' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/mcp', headers: { authorization, host: 'localhost:3000', origin: 'https://evil.example' } })).statusCode).toBe(403);
  });
});
