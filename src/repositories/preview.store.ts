import { sampleDeployments, sampleIncidents, sampleLogs, sampleRunbooks } from '../db/fixtures.js';
import type { Incident } from '../db/schema.js';
import type { EvidenceFilter, ListFilter } from '../schemas/domain.js';
import type { Store } from './store.js';
import { AppError } from '../lib/errors.js';

// Read-only fallback, explicitly labelled; never substitutes in-memory persistence for live AI.
export class PreviewStore implements Store {
  readonly mode: Store['mode'] = 'synthetic-preview';
  async health() {}
  async listIncidents(filter: ListFilter) {
    return sampleIncidents.filter(i => (!filter.service || i.serviceName === filter.service) && (!filter.severity || i.severity === filter.severity))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, filter.limit);
  }
  async getIncident(id: string) { return sampleIncidents.find(i => i.id === id); }
  async evidence(incident: Incident, filter: EvidenceFilter, windowMinutes: number) {
    const within = (date: string) => Math.abs(Date.parse(date) - Date.parse(incident.startedAt)) <= windowMinutes * 60000;
    return {
      logs: sampleLogs.filter(l => l.incidentId === incident.id && within(l.timestamp) && (!filter.level || l.level === filter.level) && (!filter.requestId || l.requestId === filter.requestId)).slice(0, 100),
      deployments: sampleDeployments.filter(d => d.serviceName === incident.serviceName && within(d.deployedAt)).slice(0, 10),
      runbooks: sampleRunbooks.filter(r => r.serviceName === incident.serviceName).slice(0, 5),
    };
  }
  async audit(..._args: Parameters<Store['audit']>) { /* No persistence in preview; request logging remains available. */ }
  async reserve(..._args: Parameters<Store['reserve']>): ReturnType<Store['reserve']> { throw new AppError('DATABASE_NOT_CONFIGURED', 'Configure PostgreSQL before running live investigations.', 503); }
  async complete(..._args: Parameters<Store['complete']>): ReturnType<Store['complete']> { throw new AppError('DATABASE_NOT_CONFIGURED', 'Configure PostgreSQL before running live investigations.', 503); }
  async fail(..._args: Parameters<Store['fail']>) {}
  async getInvestigation(..._args: Parameters<Store['getInvestigation']>): ReturnType<Store['getInvestigation']> { return undefined; }
}
