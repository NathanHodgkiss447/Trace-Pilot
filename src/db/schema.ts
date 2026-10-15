import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, jsonb, index, check, integer, date, boolean, uuid, pgEnum } from 'drizzle-orm/pg-core';
import type { Analysis } from '../schemas/domain.js';
import type { EvidenceBundle } from '../services/evidence.service.js';

const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
export const severityEnum = pgEnum('severity', ['critical', 'high', 'medium', 'low']);
export const incidentStatusEnum = pgEnum('incident_status', ['open', 'investigating', 'resolved']);
export const logLevelEnum = pgEnum('log_level', ['debug', 'info', 'warn', 'error', 'fatal']);
export const investigationStatusEnum = pgEnum('investigation_status', ['running', 'completed', 'failed']);
export const incidents = pgTable('incidents', {
  id: text('id').primaryKey(), title: text('title').notNull(), description: text('description').notNull(),
  serviceName: text('service_name').notNull(), severity: severityEnum('severity').notNull(),
  status: incidentStatusEnum('status').notNull().default('open'),
  startedAt: time('started_at').notNull(), resolvedAt: time('resolved_at'), createdAt: time('created_at').notNull().defaultNow(),
}, t => [index('incidents_service_started_idx').on(t.serviceName, t.startedAt), index('incidents_severity_idx').on(t.severity),
  check('incident_id_format', sql`${t.id} ~ '^INC-[0-9]{4,8}$'`),
  check('incident_resolution_order', sql`${t.resolvedAt} IS NULL OR ${t.resolvedAt} >= ${t.startedAt}`)]).enableRLS();
export const logs = pgTable('application_logs', {
  id: text('id').primaryKey(), incidentId: text('incident_id').notNull().references(() => incidents.id, { onDelete: 'restrict' }),
  serviceName: text('service_name').notNull(), level: logLevelEnum('level').notNull(), message: text('message').notNull(),
  requestId: text('request_id'), timestamp: time('timestamp').notNull(), metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
}, t => [index('logs_incident_time_idx').on(t.incidentId, t.timestamp), index('logs_request_idx').on(t.requestId),
  check('log_id_format', sql`${t.id} ~ '^LOG-[A-Za-z0-9-]+$'`), check('log_message_size', sql`length(${t.message}) <= 4000`)]).enableRLS();
export const deployments = pgTable('deployment_events', {
  id: text('id').primaryKey(), serviceName: text('service_name').notNull(), version: text('version').notNull(),
  deployedAt: time('deployed_at').notNull(), environment: text('environment').notNull(), description: text('description').notNull(),
}, t => [index('deployments_service_time_idx').on(t.serviceName, t.deployedAt), check('deployment_id_format', sql`${t.id} ~ '^DEP-[A-Za-z0-9-]+$'`)]).enableRLS();
export const runbooks = pgTable('runbooks', {
  id: text('id').primaryKey(), title: text('title').notNull(), serviceName: text('service_name').notNull(),
  content: text('content').notNull(), createdAt: time('created_at').notNull().defaultNow(),
}, t => [index('runbooks_service_idx').on(t.serviceName), check('runbook_id_format', sql`${t.id} ~ '^RUN-[A-Za-z0-9-]+$'`),
  check('runbook_content_size', sql`length(${t.content}) <= 8000`)]).enableRLS();
export const investigations = pgTable('investigations', {
  id: uuid('id').primaryKey().defaultRandom(), incidentId: text('incident_id').notNull().references(() => incidents.id),
  status: investigationStatusEnum('status').notNull().default('running'), summary: text('summary'), severity: severityEnum('severity'),
  hypotheses: jsonb('hypotheses').$type<Analysis['hypotheses']>(),
  observations: jsonb('observations').$type<Analysis['observations']>(),
  missingEvidence: jsonb('missing_evidence').$type<string[]>(),
  recommendedActions: jsonb('recommended_actions').$type<Analysis['recommendedActions']>(),
  humanReviewRequired: boolean('human_review_required').notNull().default(true),
  evidenceIds: jsonb('evidence_ids').$type<string[]>().notNull(),
  evidenceSnapshot: jsonb('evidence_snapshot').$type<EvidenceBundle>().notNull(),
  modelName: text('model_name').notNull(), usage: jsonb('usage').$type<Record<string, number>>(), errorCode: text('error_code'),
  createdAt: time('created_at').notNull().defaultNow(), completedAt: time('completed_at'),
}, t => [index('investigations_incident_created_idx').on(t.incidentId, t.createdAt),
  check('investigation_completion', sql`(${t.status} = 'running' AND ${t.completedAt} IS NULL) OR (${t.status} IN ('completed', 'failed') AND ${t.completedAt} IS NOT NULL)`),
  check('investigation_result_required', sql`${t.status} <> 'completed' OR (${t.summary} IS NOT NULL AND ${t.hypotheses} IS NOT NULL AND ${t.recommendedActions} IS NOT NULL AND ${t.observations} IS NOT NULL AND ${t.missingEvidence} IS NOT NULL AND ${t.severity} IS NOT NULL)`)]).enableRLS();
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(), action: text('action').notNull(), resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'), requestId: text('request_id').notNull(), timestamp: time('timestamp').notNull().defaultNow(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
}, t => [index('audit_request_idx').on(t.requestId), index('audit_resource_time_idx').on(t.resourceType, t.resourceId, t.timestamp)]).enableRLS();
export const dailyUsage = pgTable('daily_usage', {
  day: date('day').primaryKey(), count: integer('count').notNull(),
}, t => [check('daily_usage_nonnegative', sql`${t.count} >= 0`)]).enableRLS();

export type Incident = typeof incidents.$inferSelect;
export type Log = typeof logs.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;
export type Runbook = typeof runbooks.$inferSelect;
export type Investigation = typeof investigations.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferInsert;
