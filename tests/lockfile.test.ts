import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface LockedPackage {
  version?: string;
  link?: boolean;
  resolved?: string;
  integrity?: string;
  bin?: Record<string, string>;
}

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, LockedPackage> };

describe('portable deployment dependencies', () => {
  it('records complete registry metadata for every installed package, including optional platform binaries', () => {
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path) continue;
      expect(entry, path).toMatchObject({
        version: expect.stringMatching(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
        resolved: expect.stringMatching(/^https:\/\/registry\.npmjs\.org\/.+\.tgz$/),
        integrity: expect.stringMatching(/^sha512-/),
      });
    }
  });
  it('does not depend on local testing links or directories outside the repository', () => {
    const nonPortable = Object.entries(lock.packages).filter(([path, entry]) =>
      entry.link || path.startsWith('../') || path.startsWith('/') ||
      (entry.resolved && /^(?:file:|link:|\.{1,2}\/|\/)/.test(entry.resolved)));
    expect(nonPortable.map(([path]) => path)).toEqual([]);
  });
  it('locks the TypeScript compiler to a registry archive with an integrity checksum', () => {
    expect(lock.packages['node_modules/typescript']).toMatchObject({
      version: expect.any(String),
      resolved: expect.stringMatching(/^https:\/\/registry\.npmjs\.org\/typescript\/-\/typescript-/),
      integrity: expect.stringMatching(/^sha512-/),
      bin: { tsc: 'bin/tsc' },
    });
  });
});
