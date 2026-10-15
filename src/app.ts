import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { z } from 'zod';
import type { Env } from './config/env.js';
import { loadEnv } from './config/env.js';
import { connectDatabase } from './db/client.js';
import { exampleSnapshot } from './db/fixtures.js';
import { PostgresStore } from './repositories/postgres.store.js';
import { PreviewStore } from './repositories/preview.store.js';
import type { Store } from './repositories/store.js';
import { createAnalyzer } from './services/ai.service.js';
import type { AiAnalyzer } from './services/ai.service.js';
import { EvidenceService } from './services/evidence.service.js';
import { InvestigationService } from './services/investigation.service.js';
import { createMcpServer } from './mcp/server.js';
import { AppError, safeError } from './lib/errors.js';
import { verifyBearer } from './lib/auth.js';
import { evidenceFilter, incidentId, listFilter, analysisSchema } from './schemas/domain.js';
import { bundleSchema, envelope, errorSchema, incidentSchema, investigationSchema, jsonSchema } from './schemas/api.js';

export async function buildApp(options: { env?: Env; store?: Store; ai?: AiAnalyzer; logger?: boolean } = {}) {
  const env = options.env ?? loadEnv();
  const app = Fastify({
    logger: options.logger === false ? false : {
      level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    genReqId: () => randomUUID(), requestIdHeader: false, bodyLimit: 32768,
    requestTimeout: 10000, connectionTimeout: 10000, forceCloseConnections: true,
    ajv: { customOptions: { removeAdditional: false, allErrors: false } },
  });
  const database = !options.store && env.DATABASE_URL ? connectDatabase(env) : undefined;
  const store = options.store ?? (database ? new PostgresStore(database.db) : new PreviewStore());
  const evidence = new EvidenceService(store, env.EVIDENCE_WINDOW_MINUTES);
  const service = new InvestigationService(store, evidence, options.ai ?? createAnalyzer(env.OPENAI_API_KEY, env.OPENAI_MODEL, env.AI_TIMEOUT_MS), env,
    category => app.log.error({ category }, 'Investigation persistence failed'));
  if (database) app.addHook('onClose', async () => { await database.client.end({ timeout: 5 }); });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute',
    errorResponseBuilder: () => new AppError('RATE_LIMITED', 'Too many requests. Retry later.', 429) });
  await app.register(swagger, {
    openapi: {
      info: { title: 'TracePilot — From incidents to insights.', version: '1.0.0',
        description: 'Backend incident investigation using synthetic data only. REST and MCP share evidence retrieval, AI orchestration and PostgreSQL persistence. Public demos and this explorer are read-only. AI hypotheses are never verified root causes. Protected REST uses an owner-controlled AdminBearer token; MCP uses an independent token. This MVP does not provide multi-user authentication or automatic remediation.' },
      components: { securitySchemes: { AdminBearer: { type: 'http', scheme: 'bearer', description: 'ADMIN_API_TOKEN, configured only on the server and owner client.' } } },
      tags: [{ name: 'Demo', description: 'Read-only fictional evidence; no model calls.' }, { name: 'Owner', description: 'Protected operations, live AI disabled by default.' }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { supportedSubmitMethods: ['get'], persistAuthorization: false } });
  const errorResponses = Object.fromEntries([400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503, 504].map(status => [status, jsonSchema(errorSchema)]));
  app.addHook('onRequest', async (request, reply) => { reply.header('X-Request-Id', request.id); });
  app.setErrorHandler((error, request, reply) => {
    const details = error && typeof error === 'object' ? error as { validation?: unknown; statusCode?: unknown } : undefined;
    const safe = error instanceof z.ZodError || details?.validation
      ? new AppError('INVALID_INPUT', 'Request parameters or body are invalid.', 400)
      : details?.statusCode === 413 ? new AppError('BODY_TOO_LARGE', 'Request body exceeds the permitted size.', 413)
      : details?.statusCode === 415 ? new AppError('UNSUPPORTED_MEDIA_TYPE', 'Use application/json.', 415)
      : details?.statusCode === 400 ? new AppError('INVALID_INPUT', 'Request is malformed.', 400)
      : safeError(error);
    request.log.warn({ requestId: request.id, category: safe.code, status: safe.statusCode }, 'Request failed');
    if (safe.statusCode === 401) reply.header('WWW-Authenticate', 'Bearer realm="TracePilot"');
    return reply.status(safe.statusCode).send({ error: { code: safe.code, message: safe.message }, requestId: request.id });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route was not found.' }, requestId: request.id }));
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({ requestId: request.id, endpoint: request.routeOptions.url, status: reply.statusCode, duration: reply.elapsedTime }, 'Request completed');
  });
  const response = (data: unknown, requestId: string) => ({ data, requestId, metadata: { synthetic: true, persistence: store.mode } });
  const auth = (token: string | undefined, resource: string) => async (request: import('fastify').FastifyRequest) => {
    try { verifyBearer(request.headers.authorization, token); }
    catch (error) {
      try { await store.audit({ action: 'authentication.failed', resourceType: resource, requestId: request.id }); }
      catch { request.log.error({ category: 'audit_write_failed' }, 'Authentication failure audit could not be saved'); }
      throw error;
    }
  };
  const adminAuth = auth(env.ADMIN_API_TOKEN, 'rest');
  const admin = [app.rateLimit({ max: 60, timeWindow: '1 minute' }), adminAuth];
  const routeSchema = (data: z.ZodType, summary: string, owner = false) => ({
    summary, tags: [owner ? 'Owner' : 'Demo'], ...(owner ? { security: [{ AdminBearer: [] }] } : {}),
    response: { 200: jsonSchema(envelope(data)), ...errorResponses },
  });
  app.get('/', { schema: { hide: true } }, async (_request, reply) => reply.redirect('/docs'));
  app.get('/health', { schema: routeSchema(z.object({ status: z.literal('ok'), database: z.string(), aiEnabled: z.boolean() }), 'Application and database readiness') }, async request => {
    try { await store.health(); }
    catch { throw new AppError('DATABASE_UNAVAILABLE', 'Database is unavailable.', 503); }
    return response({ status: 'ok', database: store.mode, aiEnabled: env.ENABLE_AI_INVESTIGATIONS }, request.id);
  });
  app.get('/api/demo/incidents', { schema: { ...routeSchema(z.array(incidentSchema), 'List synthetic incidents'), querystring: jsonSchema(listFilter) } }, async request => {
    return response(await store.listIncidents(listFilter.parse(request.query)), request.id);
  });
  const incidentParams = z.strictObject({ id: incidentId });
  app.get('/api/demo/incidents/:id', { schema: { ...routeSchema(z.object({ incident: incidentSchema, evidence: bundleSchema }), 'Inspect a synthetic incident (try INC-1042)'), params: jsonSchema(incidentParams) } }, async request => {
    const { id } = incidentParams.parse(request.params);
    const bundle = await evidence.retrieve(id);
    // Public surface omits metadata and request IDs and bounds log records further.
    const publicBundle = { ...bundle,
      logs: bundle.logs.slice(0, 10).map(log => ({ ...log, metadata: { synthetic: true }, requestId: null })),
      correlations: { ...bundle.correlations, requestGroups: [] },
    };
    return response({ incident: bundle.incident, evidence: publicBundle }, request.id);
  });
  app.get('/api/demo/example-investigation', { schema: routeSchema(z.object({ example: z.literal(true), generatedLive: z.literal(false), source: z.string(), analysis: analysisSchema }), 'Hand-authored example snapshot; never calls OpenAI') }, async request => response(exampleSnapshot, request.id));
  app.get('/api/incidents/:id/evidence', { onRequest: admin, schema: {
    ...routeSchema(bundleSchema, 'Retrieve bounded evidence and correlations', true), params: jsonSchema(incidentParams), querystring: jsonSchema(evidenceFilter),
  } }, async request => response(await evidence.retrieve(incidentParams.parse(request.params).id, evidenceFilter.parse(request.query)), request.id));
  const analysisInput = z.strictObject({ incidentId });
  app.post('/api/investigations', { onRequest: [app.rateLimit({ max: 10, timeWindow: '1 minute' }), adminAuth], schema: {
    ...routeSchema(investigationSchema, 'Create and persist an owner-only live AI investigation', true), body: { ...jsonSchema(analysisInput), examples: [{ incidentId: 'INC-1042' }] },
  } }, async (request, reply) => {
    const result = await service.analyze(analysisInput.parse(request.body).incidentId, request.id);
    reply.header('Location', `/api/investigations/${result.id}`);
    return response(result, request.id);
  });
  const investigationParams = z.strictObject({ id: z.uuid() });
  app.get('/api/investigations/:id', { onRequest: admin, schema: {
    ...routeSchema(investigationSchema, 'Retrieve a persisted investigation', true), params: jsonSchema(investigationParams),
  } }, async request => response(await service.get(investigationParams.parse(request.params).id), request.id));

  const context = new AsyncLocalStorage<string>();
  const mcp = createMcpHandler(() => createMcpServer(store, evidence, service, context.getStore() ?? randomUUID(),
    (tool, status, duration, category) => app.log.info({ requestId: context.getStore(), tool, status, duration, category }, 'MCP tool completed')));
  const nodeHandler = toNodeHandler(mcp, { onerror: () => app.log.error({ requestId: context.getStore(), category: 'mcp_transport_error' }, 'MCP transport failed'), maxRequestBodySize: 32768 });
  app.addHook('onClose', async () => { await mcp.close(); });
  const base = new URL(env.PUBLIC_BASE_URL);
  const hosts = new Set([base.host, ...(env.NODE_ENV !== 'production' ? ['localhost:3000', '127.0.0.1:3000', '[::1]:3000'] : [])]);
  app.all('/mcp', { schema: { hide: true }, onRequest: [app.rateLimit({ max: 60, timeWindow: '1 minute' }), auth(env.MCP_BEARER_TOKEN, 'mcp'), async request => {
    // Exact authority and origin; do not trust X-Forwarded-Host supplied by a caller.
    if (!hosts.has(request.headers.host ?? '')) throw new AppError('FORBIDDEN_HOST', 'MCP host is not allowed.', 403);
    if (request.headers.origin && request.headers.origin !== base.origin) throw new AppError('FORBIDDEN_ORIGIN', 'MCP origin is not allowed.', 403);
  }] }, async (request, reply) => {
    reply.hijack();
    reply.raw.setHeader('X-Request-Id', request.id);
    await context.run(request.id, () => nodeHandler(request.raw, reply.raw, request.body));
  });
  return app;
}
