import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { incidentId, listFilter } from '../schemas/domain.js';
import { bundleSchema, incidentSchema, investigationSchema } from '../schemas/api.js';
import type { Store } from '../repositories/store.js';
import type { EvidenceService } from '../services/evidence.service.js';
import type { InvestigationService } from '../services/investigation.service.js';
import { safeError } from '../lib/errors.js';

const output = (data: z.ZodType) => z.object({ data, requestId: z.string(), metadata: z.object({ synthetic: z.literal(true) }) });
export function createMcpServer(store: Store, evidence: EvidenceService, investigations: InvestigationService, requestId: string,
  log: (name: string, status: string, duration: number, category?: string) => void) {
  const server = new McpServer({ name: 'tracepilot', version: '1.0.0' });
  async function run(name: string, action: () => Promise<unknown>) {
    const started = performance.now();
    try {
      await store.audit({ action: 'mcp.tool_invoked', resourceType: 'mcp_tool', resourceId: name, requestId });
      const structuredContent = { data: await action(), requestId, metadata: { synthetic: true as const } };
      log(name, 'success', performance.now() - started);
      return { content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }], structuredContent };
    } catch (error) {
      const safe = safeError(error);
      log(name, 'error', performance.now() - started, safe.code);
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: { code: safe.code, message: safe.message }, requestId }) }] };
    }
  }
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  server.registerTool('list_incidents', {
    description: 'List bounded fictional incidents, optionally filtered by service and severity.', inputSchema: listFilter, outputSchema: output(z.array(incidentSchema)), annotations: read,
  }, args => run('list_incidents', () => store.listIncidents(listFilter.parse(args))));
  server.registerTool('get_incident_context', {
    description: 'Retrieve bounded synthetic incident metadata, logs, deployments, runbooks and deterministic correlations.',
    inputSchema: z.strictObject({ incidentId }), outputSchema: output(bundleSchema), annotations: read,
  }, args => run('get_incident_context', () => evidence.retrieve(args.incidentId)));
  server.registerTool('analyze_incident', {
    description: 'Run a paid OpenAI investigation if the owner enabled it and the persistent daily quota permits. Saves validated hypotheses; never performs remediation.',
    inputSchema: z.strictObject({ incidentId }), outputSchema: output(investigationSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, args => run('analyze_incident', () => investigations.analyze(args.incidentId, requestId)));
  server.registerTool('get_investigation', {
    description: 'Retrieve a saved investigation and its validated evidence references by UUID.',
    inputSchema: z.strictObject({ investigationId: z.uuid() }), outputSchema: output(investigationSchema), annotations: read,
  }, args => run('get_investigation', () => investigations.get(args.investigationId)));
  return server;
}
