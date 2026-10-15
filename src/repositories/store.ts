import type { AuditEvent, Deployment, Incident, Investigation, Log, Runbook } from '../db/schema.js';
import type { Analysis, EvidenceFilter, ListFilter } from '../schemas/domain.js';
import type { EvidenceBundle } from '../services/evidence.service.js';

export interface EvidenceRecords { logs: Log[]; deployments: Deployment[]; runbooks: Runbook[] }
export interface Store {
  mode: 'postgres' | 'synthetic-preview' | 'test';
  health(): Promise<void>;
  listIncidents(filter: ListFilter): Promise<Incident[]>;
  getIncident(id: string): Promise<Incident | undefined>;
  evidence(incident: Incident, filter: EvidenceFilter, windowMinutes: number): Promise<EvidenceRecords>;
  audit(event: AuditEvent): Promise<void>;
  reserve(bundle: EvidenceBundle, requestId: string, model: string, dailyLimit: number): Promise<Investigation>;
  complete(id: string, analysis: Analysis, usage: Record<string, number>, requestId: string): Promise<Investigation>;
  fail(id: string, code: string, requestId: string, usage?: Record<string, number>): Promise<void>;
  getInvestigation(id: string): Promise<Investigation | undefined>;
}
