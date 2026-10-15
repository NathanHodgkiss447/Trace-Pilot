# TracePilot

**From incidents to insights.**

An incident investigation backend built with TypeScript, Fastify, PostgreSQL and OpenAI, exposing structured investigations through REST and MCP. It demonstrates the engineering around an LLM: bounded retrieval, explicit uncertainty, validated citations, durable cost controls, transactional persistence and auditable failures.

TracePilot uses **fictional operational data only**. Its output is a set of hypotheses requiring human verification. It never runs remediation commands.

**Delivery status:** type checking, lint, build and automated REST/MCP/AI tests pass. The owner confirmed successful database seeding, database verification and local HTTP/MCP verification. Public deployment and a real AI investigation remain pending. See [verification status](docs/VERIFICATION.md) for the exact checks and their source.

## Two-minute tour

1. Open `/docs` for interactive, read-only API exploration.
2. Read `/api/demo/incidents/INC-1042` for a fictional checkout incident.
3. Read `/api/demo/example-investigation` for a **hand-authored example**, with observations, hypotheses, citations and verification steps. This never calls OpenAI.
4. Review [investigation orchestration](src/services/investigation.service.ts), [evidence validation](src/lib/evidence-validator.ts), [atomic quota reservation](src/repositories/postgres.store.ts) and [MCP tools](src/mcp/server.ts).

| Resource | Address |
| --- | --- |
| Public GitHub repository | Not created; account/network access required |
| Railway service | Not deployed; account/network access required |
| Local documentation | http://localhost:3000/docs |
| Local MCP endpoint | http://localhost:3000/mcp |

## Architecture

```mermaid
flowchart TD
    REST[Fastify REST API] --> Auth[Separate owner bearer tokens]
    MCP[MCP v2 Streamable HTTP] --> Auth
    Auth --> Service[Shared Investigation Service]
    Service --> Evidence[Bounded Evidence Retrieval and Correlation]
    Evidence --> DB[(PostgreSQL: synthetic source records)]
    Evidence --> Quota[Atomic daily quota and running investigation]
    Quota --> DB
    Quota --> AI[OpenAI Responses API: structured output]
    AI --> Validate[Zod schema and evidence ID validation]
    Validate --> Save[Completed result and audit event in one transaction]
    Save --> DB
    AI --> Failure[Safe failure category and failed investigation]
    Failure --> DB
```

Thin route and tool handlers call the same domain services. The repository interface isolates database access, and an injectable AI analyzer supports deterministic testing. There is one deployable process, no queue, user management system or frontend dashboard.

## Features

- Six synthetic incidents: connection pool exhaustion, checkout deployment regression, auth timeouts, memory pressure, external rate limits and background job contract failures.
- Deterministic filtering by service, incident severity, log level, request ID and time window.
- Deployment proximity, error counts, repeated messages and request grouping calculated before the model call.
- Structured observations, confidence classes, supporting/contradicting citations and recommended verification steps.
- Separate authenticated REST and MCP interfaces over the same services.
- PostgreSQL persistence, evidence snapshots, lifecycle audits and atomic daily quotas.
- Keyless read-only preview and clearly labelled example data.
- Swagger, Docker, Railway configuration and GitHub Actions verification workflow.

## Stack

Node.js 24 LTS; strict TypeScript; Fastify 5; Zod 4; PostgreSQL; Drizzle ORM and Drizzle Kit; Postgres.js; official OpenAI Node SDK with Responses API; official MCP TypeScript SDK v2 server/client and Node adapter; Vitest; ESLint; Swagger UI. Supabase and Railway are the intended managed database and application hosts.

The package manifest declares compatible release ranges, and `package-lock.json` records resolved versions. Use `npm ci` for a clean installation. Real PostgreSQL concurrency tests require a dedicated test database; remote deployment verification remains pending.

## Local setup

Requirements: Node 24, npm, and either Docker for local PostgreSQL or a Supabase PostgreSQL connection.

```sh
npm install
cp .env.example .env
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```

Put the two independently generated values into `ADMIN_API_TOKEN` and `MCP_BEARER_TOKEN` in `.env`. Do not reuse them. The native Node `.env` loader preserves variables already set in the environment.

For a local database:

```sh
docker compose up -d
```

Set `DATABASE_URL=postgresql://tracepilot:local-development-only@localhost:5432/tracepilot` in your untracked `.env`, then:

```sh
npm run db:migrate
npm run db:seed
npm run db:verify
npm run verify
npm run dev
```

Open http://localhost:3000/docs. `npm run build && npm start` runs compiled JavaScript. `npm run db:generate` generates migrations from changes to `src/db/schema.ts`; review the SQL before applying it. The initial checked-in SQL and Drizzle snapshot form the migration baseline. Migration execution and repeatability still require real PostgreSQL verification in this delivery environment.

If setup fails, run `npm run db:check` for a read-only connectivity/TLS check. Database checks and migrations print safe error codes with guidance instead of raw exceptions or connection strings. A TLS trust error requires configuring `DATABASE_CA_PATH` with the project's server root certificate; a DNS/network error requires checking connectivity and the copied host.

For a **read-only preview**, leave `DATABASE_URL` and `OPENAI_API_KEY` empty and keep `ENABLE_AI_INVESTIGATIONS=false`. Public endpoints use bundled fixtures and explicitly report `persistence: synthetic-preview`. No investigation writes or durable audits occur in preview mode. Production requires PostgreSQL and both tokens even when AI is disabled.

## Environment variables

| Variable | Purpose / default |
| --- | --- |
| `DATABASE_URL` | Exact PostgreSQL URI; required in production and for live analysis |
| `DATABASE_CA_PATH` | Optional local path to Supabase's PEM CA certificate |
| `DATABASE_CA_CERT` | Alternative complete multiline PEM CA certificate, suitable for Railway; leave `DATABASE_CA_PATH` unset when using this |
| `OPENAI_API_KEY` | Server-side key; required only when live AI is enabled |
| `OPENAI_MODEL` | `gpt-4.1-mini`; configurable model supporting Responses and Structured Outputs |
| `ADMIN_API_TOKEN` | Independent random token, at least 32 characters, for protected REST |
| `MCP_BEARER_TOKEN` | Different random token, at least 32 characters, for all MCP access |
| `ENABLE_AI_INVESTIGATIONS` | `false`; owner kill switch, requires process restart when changed |
| `MAX_DAILY_INVESTIGATIONS` | `5`; UTC daily quota, integer 0–100; zero rejects all analyses |
| `PORT` | `3000` locally; use Railway's injected value in deployment |
| `NODE_ENV` | `development`, `test` or `production` |
| `PUBLIC_BASE_URL` | Exact externally reachable origin; defaults to `http://localhost:3000`; production requires HTTPS |
| `EVIDENCE_WINDOW_MINUTES` | `60`; symmetric window around onset, configurable from 5–1440 minutes |
| `AI_TIMEOUT_MS` | `25000`; overall provider-call deadline, including the bounded retry |

Test-only variables: `TEST_DATABASE_URL` points to a **dedicated disposable test database**; `TRACEPILOT_LIVE_SMOKE=true` explicitly permits the optional paid SDK smoke test. The deployment script also supports `ALLOW_AI_ENABLED=true` and `VERIFY_LIVE_AI=true`, described in [deployment instructions](docs/DEPLOYMENT.md). None of these flags enables the server's AI kill switch.

Never commit `.env`, certificates, tokens or connection strings. The public service never returns credentials. Log records include server-generated request IDs, route/tool name, status and duration; errors use curated categories without raw exception serialization.

## API

All JSON REST responses use `{ data, requestId, metadata }` or `{ error: { code, message }, requestId }`. Protected routes use `Authorization: Bearer <ADMIN_API_TOKEN>`.

| Method | Route | Access |
| --- | --- | --- |
| GET | `/health` | Public readiness; checks configured database |
| GET | `/docs` | Public interactive Swagger; only GET submissions enabled |
| GET | `/api/demo/incidents` | Public bounded synthetic list |
| GET | `/api/demo/incidents/:id` | Public incident and a bounded, redacted evidence view |
| GET | `/api/demo/example-investigation` | Public labelled example; no paid request |
| GET | `/api/incidents/:id/evidence` | Owner; complete bounded evidence package |
| POST | `/api/investigations` | Owner; `{ "incidentId": "INC-1042" }`; synchronous analysis |
| GET | `/api/investigations/:id` | Owner; persisted result and status |
| POST / GET / DELETE | `/mcp` | Independent MCP token; SDK handles transport methods |

Public list filters: `service`, `severity`, `limit` (1–50). Evidence filters: `service`, `severity`, `level`, `requestId`, `windowMinutes`. Incident IDs must match `INC-` followed by 4–8 digits; investigation IDs are UUIDs. Unknown fields and oversized bodies are rejected.

Examples: `INC-1041` (database), `INC-1042` (checkout), `INC-1043` (insufficient auth evidence), `INC-1044` (memory), `INC-1045` (rate limiting), `INC-1046` (jobs).

## Database design

`incidents` has many `application_logs` and `investigations` through foreign keys. Deployments and runbooks are keyed by service because their relevance is determined at retrieval time, rather than being owned by one incident. Source evidence has stable, distinct `LOG-`, `DEP-` and `RUN-` identifiers.

Indexes support incident service/time filters, severity, incident/log timestamp windows, request ID grouping, service/deployment windows, service/runbook retrieval, saved investigation history and request/resource audit lookup. Enum constraints define severities, levels and lifecycle states. Check constraints enforce ID prefixes, resolution ordering, source content bounds and valid completion state.

Hypotheses, observations and actions use typed JSONB. An investigation retains a bounded evidence snapshot to reproduce the context used for its citations; this is intentional provenance, alongside relational source records. `audit_events` records lifecycle/security metadata. `daily_usage` has one UTC date key and an integer attempt count.

Quota reservation uses `INSERT ... ON CONFLICT DO UPDATE ... WHERE count < limit RETURNING` inside the same transaction as the running investigation and start audit. Concurrent instances compete against PostgreSQL's row lock. Provider calls happen after commit, outside the transaction. Completion/result and completion audit are committed together; failure state and audit are also transactional. Attempts are not refunded after provider failures or crashes. A crashed process can leave a `running` row, which requires owner inspection; there is no automatic paid replay.

Row-level security is enabled without public policies to deny Supabase Data API access. The backend uses its server-side database owner connection; this is not a multi-tenant authorization layer.

## AI architecture

1. Retrieve source records through parameterized Drizzle queries. Select at most 100 logs, 10 deployments and 5 runbooks; reject serialized context above 180 KB.
2. Calculate deterministic correlations. A preceding deployment is a temporal observation, not a causal conclusion.
3. Reserve the database-backed daily attempt before calling OpenAI.
4. Send a system policy and one bounded evidence JSON package using the official SDK's `responses.parse` and `zodTextFormat`. `store: false` is set. No tool execution capability is supplied.
5. Parse the strict schema and check incident identity and **every structured citation** against the supplied evidence IDs. Reject overlapping supporting/contradicting classifications for one hypothesis. Non-low confidence requires operational evidence. Human review is mandatory.
6. If citations are fabricated, retry once with bounded corrective instructions. Otherwise fail safely. There are at most two provider calls total: a transient retry or a citation correction. The SDK's own retries are disabled.
7. Save only validated completed results, along with model name, available token counts, evidence snapshot and audit events.

Timeouts, rate limits, provider failures, unsupported model settings, invalid schemas, refusals, incomplete output and insufficient evidence produce distinct safe errors. No credentials means a configuration error, never fabricated live output. Logs and runbooks are explicitly untrusted data, including a seeded prompt-injection example.

Citation membership does **not** establish that the evidence supports the claim or that a root cause is true. Prompt instructions and schema checks do not guarantee perfect reasoning or prompt-injection resistance. Human review remains necessary.

## MCP architecture and connection

The official SDK v2 `createMcpHandler` creates request-scoped servers, and `toNodeHandler` mounts Streamable HTTP on Fastify's raw request/response. Fastify's parsed body is passed to the adapter; the handler is closed with the application. Host and Origin checks protect the remote endpoint. There is no custom JSON endpoint pretending to be MCP and no legacy SSE transport.

| Tool | Input | Structured output |
| --- | --- | --- |
| `list_incidents` | optional `service`, `severity`, `limit` | Bounded incident array |
| `get_incident_context` | `incidentId` | Typed evidence bundle and correlations |
| `analyze_incident` | `incidentId` | Persisted investigation with hypotheses and citations |
| `get_investigation` | `investigationId` (UUID) | Persisted investigation |

Tools have Zod input/output schemas, descriptions and read-only/idempotency annotations. Domain failures return MCP `isError: true` text content with a safe error code. Successful results include both text and `structuredContent`. The analysis tool is explicitly not idempotent. REST tokens cannot authorize MCP, and MCP tokens cannot authorize REST.

Configure any client supporting **Streamable HTTP with custom bearer headers**:

```text
URL: https://YOUR-RAILWAY-DOMAIN/mcp
Transport: Streamable HTTP
Authorization header: Bearer <your private MCP_BEARER_TOKEN>
```

Use the client's private secret configuration, not a repository file or URL query string. OAuth-only clients are not supported by this static-token MVP.

With `.env` configured and the server running:

```sh
npm run demo:mcp
npm run demo:mcp -- list_incidents
npm run demo:mcp -- get_incident_context INC-1042
npm run demo:mcp -- get_investigation SAVED-INVESTIGATION-UUID
# Paid, only after the server owner explicitly enables live analysis:
npm run demo:mcp -- analyze_incident INC-1042
```

For manual protocol inspection, run `npx @modelcontextprotocol/inspector`, select Streamable HTTP, enter the endpoint and private bearer header, connect, list tools and invoke `get_incident_context`. Record the result; a generic HTTP 200 is not evidence of protocol compatibility. **Inspector execution is pending in this delivery.** The automated suite uses the official client and transport with an injection-backed fetch adapter; the deployment verifier uses real remote HTTP.

## Testing

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Normal tests do not make paid calls. They cover deterministic retrieval, correlations, schemas, citation rejection, missing/contradictory evidence, lifecycle transitions, quotas and tokens; Fastify injection covers public/protected routes; the official MCP client covers initialization, discovery, schemas, invocation, invalid input and authentication; mocked OpenAI responses cover success, correction, timeout, rate limiting, refusal and incomplete output.

For real PostgreSQL verification, set `TEST_DATABASE_URL` to a dedicated disposable database before `npm test`. The suite applies migrations twice, seeds twice, verifies foreign keys, exercises concurrent quota reservations, saves results and reads audit events. It resets that test database's quota counter. **Never point it at a shared or deployed database.**

For an explicitly paid, optional SDK smoke test, configure `OPENAI_API_KEY` locally and run `npm run test:smoke`. This tests the model boundary directly, does not persist an investigation and is outside the server's daily quota. To test the full deployed path with persistence and both interfaces, use the deployment verifier instead.

See [the exact executed results](docs/VERIFICATION.md). Passing test specifications in the repository are not a substitute for executing them with installed dependencies and a database.

## Deployment and demonstration

Follow [Supabase / GitHub / Railway setup](docs/DEPLOYMENT.md), then [the demonstration guide](docs/DEMO.md). Migrations and seeding are separate, owner-run commands, never a startup side effect. Railway runs the compiled server as a non-root user, listens on `::` and uses `/health` for deployment readiness.

Do not enable paid analysis until public endpoints, both token boundaries and official MCP discovery/invocation have been verified. Afterward run exactly one owner-authenticated investigation, retrieve it through REST and MCP, and inspect database audit events. Record the actual domain here only after these checks succeed.

## Engineering trade-offs and limitations

- PostgreSQL gives relational constraints, transactions and cross-instance quota arbitration in one dependency.
- A shared service layer keeps REST and MCP authorization boundaries separate while preserving the same business rules.
- Structured outputs make results parseable; deterministic citation checks catch invented IDs before persistence. They cannot prove causal correctness.
- Protected model calls prevent public visitors from consuming a paid API quota. Static owner tokens are a portfolio compromise, not production-grade multi-user authentication.
- Synchronous analysis avoids a queue for this scope. Client disconnects do not guarantee provider cancellation; failed or abandoned attempts remain charged to the application quota.
- Per-instance request throttling protects the demo; PostgreSQL enforces the paid daily quota across instances. No distributed general-purpose rate limiter is included.
- Logs are selected in stable chronological order; limits can omit useful evidence. The response describes its bounds. There is no semantic search, production telemetry ingestion or log provider integration.
- All operational records are synthetic. No automated remediation, shell execution, cross-service tracing or live production access exists.
- A prompt injection can still affect model reasoning; it cannot invoke backend tools or bypass the server's citation/quota checks.
- Migration generation metadata and external SDK integration require verification after dependency installation; network and filesystem restrictions prevented a verified release here.

## Future improvements

OpenTelemetry ingestion, real log provider adapters, semantic retrieval, background investigation jobs, comparison across investigations, causal/evidence evaluation datasets and multi-user authorization. These are deliberately outside the one-day MVP scope.

## Official references consulted

- [MCP v2 package exports](https://ts.sdk.modelcontextprotocol.io/v2/get-started/packages) and [Fastify mounting recipe](https://ts.sdk.modelcontextprotocol.io/v2/serving/fastify.html)
- [OpenAI Responses Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses) and [GPT-4.1 mini capabilities](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [Supabase PostgreSQL connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Railway Fastify deployment](https://docs.railway.com/guides/fastify) and [healthchecks](https://docs.railway.com/deployments/healthchecks)
