import { describe, expect, it } from 'vitest';
import { describeDatabaseError } from '../src/lib/database-error.js';

describe('safe database diagnostics', () => {
  it('identifies TLS trust failures inside a Drizzle cause', () => {
    const error = new Error('Failed query containing sensitive parameters', {
      cause: Object.assign(new Error('private connection details'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }),
    });
    expect(describeDatabaseError(error)).toMatchObject({ code: 'SELF_SIGNED_CERT_IN_CHAIN', hint: expect.stringContaining('DATABASE_CA_PATH') });
  });
  it('distinguishes DNS lookup failure from certificate failure', () => {
    const diagnostic = describeDatabaseError({ code: 'EAI_AGAIN' });
    expect(diagnostic.code).toBe('EAI_AGAIN');
    expect(diagnostic.hint).toContain('network access');
    expect(diagnostic.hint).not.toContain('DATABASE_CA_PATH');
  });
  it('explains invalid credentials without revealing them', () => {
    const diagnostic = describeDatabaseError({ code: '28P01', message: 'password=private-password' });
    expect(diagnostic.hint).toContain('Percent-encode');
    expect(JSON.stringify(diagnostic)).not.toContain('private-password');
  });
  it('reports individual connection failures in an AggregateError', () => {
    const error = new AggregateError([{ code: 'ECONNREFUSED' }, { code: 'ENETUNREACH' }], 'connection string');
    expect(describeDatabaseError(error).code).toBe('ECONNREFUSED');
  });
  it('never includes messages, SQL, parameters, hostnames or stacks in its output', () => {
    const secret = 'postgresql://owner:private-secret@private-host/database';
    const error = { code: '42P07', message: secret, query: secret, parameters: [secret], stack: secret };
    expect(JSON.stringify(describeDatabaseError(error))).not.toContain(secret);
    expect(describeDatabaseError(error).hint).toContain('Do not drop tables');
  });
  it('handles cycles and arbitrary thrown values without exposing them', () => {
    const error: { cause?: unknown } = {};
    error.cause = error;
    expect(describeDatabaseError(error).code).toBe('DATABASE_ERROR');
    expect(describeDatabaseError('private-secret').code).toBe('DATABASE_ERROR');
    expect(describeDatabaseError(null).code).toBe('DATABASE_ERROR');
  });
  it('reports SQLSTATE codes with curated fallback text', () => {
    expect(describeDatabaseError({ code: '42601', message: 'SELECT secret' })).toMatchObject({ code: '42601', message: 'PostgreSQL rejected the database operation.' });
  });
});
