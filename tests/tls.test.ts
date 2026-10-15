import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import { describe, expect, it } from 'vitest';
import { databaseTlsOptions } from '../src/db/tls.js';

describe('database TLS configuration', () => {
  it('passes the inline CA to the driver with certificate verification enabled', () => {
    const certificate = rootCertificates[0]!;
    expect(databaseTlsOptions({ NODE_ENV: 'production', DATABASE_CA_CERT: certificate }, 'pooler.example.com'))
      .toEqual({ rejectUnauthorized: true, ca: certificate });
  });
  it('loads the CA file for local development without changing trust policy', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tracepilot-ca-test-'));
    try {
      const path = join(directory, 'ca.pem');
      writeFileSync(path, rootCertificates[0]!);
      expect(databaseTlsOptions({ NODE_ENV: 'development', DATABASE_CA_PATH: path }, 'pooler.example.com'))
        .toEqual({ rejectUnauthorized: true, ca: readFileSync(path, 'utf8') });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('uses system trust for remote databases when no custom CA is configured', () => {
    expect(databaseTlsOptions({ NODE_ENV: 'development' }, 'pooler.example.com')).toEqual({ rejectUnauthorized: true });
  });
  it('supports a local development database without TLS configuration', () => {
    expect(databaseTlsOptions({ NODE_ENV: 'development' }, 'localhost')).toBeUndefined();
  });
  it('requires verified TLS even for localhost in production', () => {
    expect(databaseTlsOptions({ NODE_ENV: 'production' }, 'localhost')).toEqual({ rejectUnauthorized: true });
  });
});
