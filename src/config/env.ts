import './local-env.js';
import { X509Certificate } from 'node:crypto';
import { z } from 'zod';

export class ConfigurationError extends Error {}

const optional = z.preprocess(value => value === '' ? undefined : value, z.string().optional());
const schema = z.object({
  DATABASE_URL: optional,
  DATABASE_CA_PATH: optional,
  DATABASE_CA_CERT: optional.refine(value => {
    if (!value) return true;
    try { new X509Certificate(value); return true; }
    catch { return false; }
  }, { message: 'Provide the complete PEM CA certificate with real line breaks.' }),
  OPENAI_API_KEY: optional,
  OPENAI_MODEL: z.string().regex(/^[a-zA-Z0-9._:-]+$/).default('gpt-4.1-mini'),
  ADMIN_API_TOKEN: optional,
  MCP_BEARER_TOKEN: optional,
  ENABLE_AI_INVESTIGATIONS: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  MAX_DAILY_INVESTIGATIONS: z.coerce.number().int().min(0).max(100).default(5),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
  EVIDENCE_WINDOW_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(25000),
}).superRefine((env, ctx) => {
  const requireField = (field: keyof typeof env, reason: string) => {
    if (!env[field]) ctx.addIssue({ code: 'custom', path: [field], message: reason });
  };
  if (env.DATABASE_URL && !/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) {
    ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'Use a PostgreSQL connection URI.' });
  }
  if (env.DATABASE_CA_PATH && env.DATABASE_CA_CERT) {
    ctx.addIssue({ code: 'custom', path: ['DATABASE_CA_CERT'], message: 'Configure either DATABASE_CA_PATH or DATABASE_CA_CERT, not both.' });
  }
  for (const name of ['ADMIN_API_TOKEN', 'MCP_BEARER_TOKEN'] as const) {
    if (env[name] && env[name].length < 32) ctx.addIssue({ code: 'custom', path: [name], message: 'Use at least 32 random characters.' });
  }
  if (env.ADMIN_API_TOKEN && env.ADMIN_API_TOKEN === env.MCP_BEARER_TOKEN) {
    ctx.addIssue({ code: 'custom', path: ['MCP_BEARER_TOKEN'], message: 'Tokens must be independent.' });
  }
  if (env.NODE_ENV === 'production' || env.ENABLE_AI_INVESTIGATIONS) {
    for (const name of ['DATABASE_URL', 'ADMIN_API_TOKEN', 'MCP_BEARER_TOKEN'] as const) requireField(name, 'Required in production or when live AI is enabled.');
  }
  if (env.NODE_ENV === 'production' && !env.PUBLIC_BASE_URL.startsWith('https://')) {
    ctx.addIssue({ code: 'custom', path: ['PUBLIC_BASE_URL'], message: 'Production requires the public HTTPS origin.' });
  }
  try {
    const base = new URL(env.PUBLIC_BASE_URL);
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/') {
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_BASE_URL'], message: 'Use an origin without credentials, a path, query or fragment.' });
    }
  } catch { /* The URL schema already reports invalid URLs without exposing values. */ }
  if (env.ENABLE_AI_INVESTIGATIONS) requireField('OPENAI_API_KEY', 'Required when live AI is enabled.');
});
export type Env = z.infer<typeof schema>;
export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    // Only field paths and curated messages, never input values or connection strings.
    throw new ConfigurationError(`Invalid configuration: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}
