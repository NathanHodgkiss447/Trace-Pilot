import { z } from 'zod';
import { analysisSchema, incidentId, level, severity } from './domain.js';

const timestamp = z.string();
export const incidentSchema = z.strictObject({
  id: incidentId, title: z.string(), description: z.string(), serviceName: z.string(), severity,
  status: z.enum(['open', 'investigating', 'resolved']), startedAt: timestamp, resolvedAt: timestamp.nullable(), createdAt: timestamp,
});
export const logSchema = z.strictObject({ id: z.string(), incidentId, serviceName: z.string(), level,
  message: z.string(), requestId: z.string().nullable(), timestamp, metadata: z.record(z.string(), z.unknown()) });
export const deploymentSchema = z.strictObject({ id: z.string(), serviceName: z.string(), version: z.string(), deployedAt: timestamp,
  environment: z.string(), description: z.string() });
export const runbookSchema = z.strictObject({ id: z.string(), title: z.string(), serviceName: z.string(), content: z.string(), createdAt: timestamp });
export const bundleSchema = z.object({
  incident: incidentSchema, logs: z.array(logSchema), deployments: z.array(deploymentSchema), runbooks: z.array(runbookSchema),
  evidenceIds: z.array(z.string()),
  selection: z.object({ windowMinutes: z.number(), maxLogs: z.number(), maxDeployments: z.number(), maxRunbooks: z.number(), bounded: z.literal(true), filter: z.record(z.string(), z.unknown()) }),
  correlations: z.object({ errorCount: z.number(), requestGroups: z.array(z.object({ requestId: z.string(), logIds: z.array(z.string()) })),
    repeatedPatterns: z.array(z.object({ message: z.string(), count: z.number(), logIds: z.array(z.string()) })),
    nearbyDeployments: z.array(z.object({ deploymentId: z.string(), minutesBeforeIncident: z.number() })) }),
});
export const investigationSchema = z.object({
  id: z.uuid(), incidentId, status: z.enum(['running', 'completed', 'failed']), analysis: analysisSchema.nullable(),
  evidenceIds: z.array(z.string()), modelName: z.string(), usage: z.record(z.string(), z.number()).nullable(),
  errorCode: z.string().nullable(), createdAt: timestamp, completedAt: timestamp.nullable(), disclaimer: z.string(),
});
export const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }), requestId: z.string() });
export const envelope = (data: z.ZodType) => z.object({ data, requestId: z.string(), metadata: z.object({ synthetic: z.literal(true), persistence: z.string() }) });
export function jsonSchema(schema: z.ZodType) {
  const { $schema: _schema, ...json } = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' });
  void _schema;
  return json;
}
