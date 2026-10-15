import type { Incident } from '../db/schema.js';
import type { EvidenceFilter } from '../schemas/domain.js';
import type { EvidenceRecords, Store } from '../repositories/store.js';
import { AppError } from '../lib/errors.js';

export interface EvidenceBundle extends EvidenceRecords {
  incident: Incident;
  evidenceIds: string[];
  selection: { windowMinutes: number; maxLogs: number; maxDeployments: number; maxRunbooks: number; bounded: true; filter: EvidenceFilter };
  correlations: {
    errorCount: number;
    requestGroups: { requestId: string; logIds: string[] }[];
    repeatedPatterns: { message: string; count: number; logIds: string[] }[];
    nearbyDeployments: { deploymentId: string; minutesBeforeIncident: number }[];
  };
}
export function correlate(incident: Incident, records: EvidenceRecords): EvidenceBundle['correlations'] {
  const groups = new Map<string, string[]>();
  const patterns = new Map<string, string[]>();
  for (const log of records.logs) {
    if (log.requestId) groups.set(log.requestId, [...(groups.get(log.requestId) ?? []), log.id]);
    if (['error', 'fatal'].includes(log.level)) patterns.set(log.message, [...(patterns.get(log.message) ?? []), log.id]);
  }
  return {
    errorCount: records.logs.filter(log => ['error', 'fatal'].includes(log.level)).length,
    requestGroups: [...groups].map(([requestId, logIds]) => ({ requestId, logIds })),
    repeatedPatterns: [...patterns].filter(([, ids]) => ids.length > 1).map(([message, logIds]) => ({ message, count: logIds.length, logIds })),
    nearbyDeployments: records.deployments.filter(d => Date.parse(d.deployedAt) <= Date.parse(incident.startedAt))
      .map(d => ({ deploymentId: d.id, minutesBeforeIncident: (Date.parse(incident.startedAt) - Date.parse(d.deployedAt)) / 60000 })),
  };
}
export class EvidenceService {
  constructor(private store: Store, private defaultWindowMinutes = 60) {}
  async retrieve(id: string, filter: EvidenceFilter = {}): Promise<EvidenceBundle> {
    const incident = await this.store.getIncident(id);
    if (!incident || (filter.service && filter.service !== incident.serviceName) || (filter.severity && filter.severity !== incident.severity)) {
      throw new AppError('INCIDENT_NOT_FOUND', 'No synthetic incident matched the request.', 404);
    }
    const windowMinutes = filter.windowMinutes ?? this.defaultWindowMinutes;
    const records = await this.store.evidence(incident, filter, windowMinutes);
    const bundle: EvidenceBundle = {
      incident, ...records,
      evidenceIds: [...records.logs, ...records.deployments, ...records.runbooks].map(r => r.id),
      selection: { windowMinutes, maxLogs: 100, maxDeployments: 10, maxRunbooks: 5, bounded: true, filter },
      correlations: correlate(incident, records),
    };
    if (Buffer.byteLength(JSON.stringify(bundle), 'utf8') > 180000) {
      throw new AppError('EVIDENCE_TOO_LARGE', 'Evidence exceeds the analysis context budget. Narrow the filters.', 422);
    }
    return bundle;
  }
}
