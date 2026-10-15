# Verification status

Recorded on 2026-10-15. Agent-executed checks and owner-reported checks are identified separately. No public deployment or live AI result is claimed.

| Check | Result | Evidence source |
| --- | --- | --- |
| TypeScript checking | Passed | Agent ran `npm run typecheck` |
| Lint | Passed | Agent ran `npm run lint` |
| Compiled build | Passed | Agent ran `npm run build` |
| Automated tests | 111 passed, 4 skipped across 11 suites | Agent ran `TEST_DATABASE_URL= TRACEPILOT_LIVE_SMOKE=false npm run verify` with freshly installed dependencies |
| Portable dependency installation | Passed with Node 24.15.0 and npm 11.19.1 in a clean temporary directory using production mode and `--include=dev --bin-links=true`; compiler check reports 5.9.2 | Reproduced `Invalid Version:` with the original lockfile, repaired incomplete Rollup records using the official registry, then repeated the install successfully |
| Clean compilation and runtime pruning | Type checking, lint and compilation passed with fresh dependencies; pruned dependencies load the compiled application without TypeScript | Agent executed the build and prune commands in the isolated directory |
| Docker image build | Not executed locally; CI now includes `docker build` | Docker socket access is denied in the agent environment |
| REST integration | Public/protected routes, authentication, validation and persistence orchestration passed | Fastify injection tests |
| MCP integration | Official client initialization, discovery, invocation, schemas, authentication and tool errors passed | Injection-backed official HTTP transport tests |
| AI boundary | Mocked Structured Outputs, citation correction/rejection, timeouts, refusals and rate limits passed | Automated tests; no paid calls |
| Database TLS configuration | Inline PEM and file-based trust configuration passed; verification remains enabled | Configuration and TLS tests |
| Supabase seeding | Completed | Owner reported success after configuring the CA certificate |
| Supabase database verification | Passed | Owner reported all requested local verifications passed |
| Local HTTP and MCP verification | Passed | Owner reported `verify:deployment` checks passed against the local server |
| PostgreSQL concurrency and quota tests | Not executed by the agent | Three tests require a dedicated disposable `TEST_DATABASE_URL` |
| Real OpenAI smoke test | Not executed | One test requires explicit paid opt-in |
| Live AI switch | Disabled | Agent checked the flag without exposing credentials |
| MCP Inspector | Not independently verified | Manual Inspector invocation remains pending |
| Public GitHub / Railway deployment | Pending | No public URLs have been created or tested |

The HTTP tests emit Fastify serializer strict-type warnings for Zod-generated record schemas; requests and assertions pass. These warnings remain a compatibility follow-up.

The agent shell cannot resolve external database hosts while network access is restricted. Git metadata is mounted read-only, GitHub/Railway CLIs are unavailable, and no account tools for either provider are connected. These restrictions do not invalidate successful checks performed in the owner's terminal.

A package lockfile is present. Docker and CI use `npm ci`. Railway supports the CA certificate through the multiline `DATABASE_CA_CERT` environment variable, so deployment does not depend on the owner's local certificate path. The local `.env` remains unchanged.

The initial lockfile captured local testing links and omitted their transitive development dependencies. Subsequent Railway logs exposed a separate `Invalid Version:` failure: 23 optional Rollup platform records lacked versions, archive URLs and integrity checksums. The exact installation failure was reproduced with npm 11.19.1, and those records were regenerated from the official npm registry without changing any previously locked package versions. The repaired lockfile passed a clean production-mode install, type checking, lint, tests and compilation. After `npm prune --omit=dev`, the compiled app started and `/health` returned HTTP 200 with TypeScript absent. npm 11.19.1 reported unapproved esbuild install hooks under its default script policy. Regression tests now validate complete registry metadata for every package, including optional platform binaries. The full Docker image still requires verification in CI/Railway because the local Docker socket is inaccessible.

## Remaining release checks

1. Publish the source and lockfile to the public `tracepilot` GitHub repository from a writable Git checkout.
2. Let CI run against its dedicated PostgreSQL service, including quota concurrency and persistence tests.
3. Deploy on Railway with live AI disabled; configure the exact public origin and inline Supabase CA certificate.
4. Run `npm run verify:deployment` against the real public origin, and verify MCP discovery/invocation using Inspector or the official client.
5. After security and quota verification, enable owner-only AI and run one real investigation. Verify the persisted result through REST and MCP, and inspect usage/audit records.
6. Record actual repository, service, Swagger and MCP URLs in the README.

Do not use the shared Supabase demo database as `TEST_DATABASE_URL`; the concurrency suite resets its test database's quota table. Do not label pending checks as successful.
