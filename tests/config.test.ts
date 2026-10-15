import { describe, expect, it } from 'vitest';
import { rootCertificates } from 'node:tls';
import { loadEnv } from '../src/config/env.js';

describe('environment validation', () => {
  it('supports keyless deterministic development', () => {
    expect(loadEnv({})).toMatchObject({ ENABLE_AI_INVESTIGATIONS: false, MAX_DAILY_INVESTIGATIONS: 5 });
  });
  it('does not treat the string false as truthy', () => { expect(loadEnv({ ENABLE_AI_INVESTIGATIONS: 'false' }).ENABLE_AI_INVESTIGATIONS).toBe(false); });
  it('requires database credentials and independent tokens in production', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow('Invalid configuration');
  });
  it('rejects reused tokens and short tokens', () => {
    expect(() => loadEnv({ ADMIN_API_TOKEN: 'x'.repeat(32), MCP_BEARER_TOKEN: 'x'.repeat(32) })).toThrow('independent');
    expect(() => loadEnv({ ADMIN_API_TOKEN: 'short' })).toThrow('32 random characters');
  });
  it('requires an API key when enabling investigations', () => {
    expect(() => loadEnv({ ENABLE_AI_INVESTIGATIONS: 'true' })).toThrow('OPENAI_API_KEY');
  });
  it('requires a plain public origin without embedded credentials or paths', () => {
    expect(() => loadEnv({ PUBLIC_BASE_URL: 'https://owner:secret@example.com' })).toThrow('without credentials');
    expect(() => loadEnv({ PUBLIC_BASE_URL: 'https://example.com/mcp' })).toThrow('without credentials');
  });
  it('never includes secret values in validation errors', () => {
    expect(() => loadEnv({ DATABASE_URL: 'very-secret-invalid-value' })).not.toThrow('very-secret-invalid-value');
    expect(() => loadEnv({ DATABASE_URL: 'very-secret-invalid-value' })).toThrow('DATABASE_URL');
  });
  it('accepts a valid inline PEM CA certificate for hosting', () => {
    const certificate = rootCertificates[0]!;
    expect(loadEnv({ DATABASE_CA_CERT: certificate }).DATABASE_CA_CERT).toBe(certificate);
  });
  it('rejects malformed inline certificates without including their contents', () => {
    expect(() => loadEnv({ DATABASE_CA_CERT: 'private-invalid-value' })).toThrow('complete PEM CA certificate');
    expect(() => loadEnv({ DATABASE_CA_CERT: 'private-invalid-value' })).not.toThrow('private-invalid-value');
  });
  it('rejects ambiguous certificate sources', () => {
    expect(() => loadEnv({ DATABASE_CA_CERT: rootCertificates[0], DATABASE_CA_PATH: '/local/ca.pem' })).toThrow('not both');
  });
});
