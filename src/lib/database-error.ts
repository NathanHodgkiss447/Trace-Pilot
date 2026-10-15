export interface DatabaseDiagnostic {
  code: string;
  message: string;
  hint: string;
}

const known: Record<string, Omit<DatabaseDiagnostic, 'code'>> = {
  EAI_AGAIN: {
    message: 'Database hostname lookup failed temporarily.',
    hint: 'Retry from a terminal with network access. Check DNS/VPN settings and copy the exact host from Supabase Connect → Session pooler.',
  },
  ENOTFOUND: {
    message: 'The database hostname could not be resolved.',
    hint: 'Check DNS/network access and recopy DATABASE_URL from Supabase Connect. Do not construct a pooler hostname manually.',
  },
  SELF_SIGNED_CERT_IN_CHAIN: {
    message: 'The database TLS certificate chain is not trusted.',
    hint: 'Download the server root certificate from Supabase Database settings. Set DATABASE_CA_PATH locally, or paste its PEM contents into DATABASE_CA_CERT on Railway. Configure only one source; keep certificate verification enabled.',
  },
  DEPTH_ZERO_SELF_SIGNED_CERT: {
    message: 'The database presented an untrusted self-signed certificate.',
    hint: 'Download the server root certificate from Supabase Database settings. Set DATABASE_CA_PATH locally, or paste its PEM contents into DATABASE_CA_CERT on Railway. Configure only one source; keep certificate verification enabled.',
  },
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: {
    message: 'The database TLS certificate chain could not be verified.',
    hint: 'Configure the server root certificate from Supabase Database settings using DATABASE_CA_PATH locally or DATABASE_CA_CERT on Railway. Check whether your network intercepts TLS.',
  },
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: {
    message: 'The database certificate issuer is not trusted locally.',
    hint: 'Configure the server root certificate from Supabase Database settings using DATABASE_CA_PATH locally or DATABASE_CA_CERT on Railway.',
  },
  ERR_TLS_CERT_ALTNAME_INVALID: {
    message: 'The database certificate does not match the configured hostname.',
    hint: 'Recopy the exact connection string from Supabase Connect and verify the selected project. Do not disable hostname verification.',
  },
  CERT_HAS_EXPIRED: {
    message: 'The database TLS certificate has expired.',
    hint: 'Check the system clock and current Supabase certificate configuration. Do not disable certificate verification.',
  },
  '28P01': {
    message: 'PostgreSQL rejected the database credentials.',
    hint: 'Check the database password and the exact pooler username from Supabase Connect. Percent-encode reserved characters in the password; do not use a Supabase API key.',
  },
  '28000': {
    message: 'PostgreSQL rejected the connection authorization.',
    hint: 'Recopy the connection parameters from Supabase Connect and check the database role and project status.',
  },
  '42501': {
    message: 'The database role does not have permission for this operation.',
    hint: 'Run migrations with the intended database owner connection. Check permissions without changing or resetting application data.',
  },
  '42P07': {
    message: 'A migration tried to create a table that already exists.',
    hint: 'Compare the existing schema with the Drizzle migration history before retrying. Do not drop tables or delete migration history to bypass this error.',
  },
  '42710': {
    message: 'A migration tried to create a database object that already exists.',
    hint: 'Compare the existing schema with the Drizzle migration history before retrying. Do not reset the database to bypass this error.',
  },
  '42P01': {
    message: 'A required database table does not exist.',
    hint: 'Check that DATABASE_URL targets the intended database, then apply the checked-in migrations with npm run db:migrate.',
  },
  '3D000': {
    message: 'The requested database does not exist.',
    hint: 'Recopy the database name and connection string from Supabase Connect.',
  },
  ENOENT: {
    message: 'A required local file could not be found.',
    hint: 'Check DATABASE_CA_PATH if configured, and run database commands from the TracePilot project root where src/db/migrations exists.',
  },
};
for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED']) {
  known[code] = {
    message: 'The database connection could not be established or was interrupted.',
    hint: 'Check network access, project status and connection settings. Use the session pooler from Supabase Connect if direct IPv6 connectivity is unavailable.',
  };
}

// Drizzle wraps driver errors in `cause`; connection failures can also be AggregateErrors.
// Never serialize raw messages, query text, parameters, stacks, hostnames or connection URIs.
export function describeDatabaseError(error: unknown): DatabaseDiagnostic {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  let sqlState: string | undefined;
  while (pending.length && seen.size < 20) {
    const candidate = pending.shift();
    if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) continue;
    seen.add(candidate);
    const record = candidate as Record<string, unknown>;
    if (typeof record.code === 'string') {
      const detail = Object.hasOwn(known, record.code) ? known[record.code] : undefined;
      if (detail) return { code: record.code, ...detail };
      if (/^[0-9A-Z]{5}$/.test(record.code)) sqlState ??= record.code;
    }
    if (record.cause) pending.push(record.cause);
    if (Array.isArray(record.errors)) pending.push(...record.errors.slice(0, 20));
  }
  return {
    code: sqlState ?? 'DATABASE_ERROR',
    message: sqlState ? 'PostgreSQL rejected the database operation.' : 'The database operation could not be completed.',
    hint: 'Check connectivity, TLS configuration and migration history. Inspect database-side logs for further details without sharing connection strings or credentials.',
  };
}
