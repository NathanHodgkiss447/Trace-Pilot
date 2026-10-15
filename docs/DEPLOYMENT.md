# Deploy TracePilot

This is an owner-run procedure. No deployment has been completed in the original restricted workspace. Do not record placeholder domains as live URLs.

## 1. Install and verify dependencies

On a network-enabled machine with Node 24:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Confirm that `@modelcontextprotocol/server`, `@modelcontextprotocol/node` and `@modelcontextprotocol/client` resolve to the v2 stable line. Inspect their installed `package.json` exports against the code imports before claiming compatibility. If package registry availability differs from the official SDK documentation, stop and resolve that mismatch; do not silently substitute v1 imports.

Commit `package-lock.json` with the source. Docker and CI use `npm ci` so deployment and automated checks install the recorded dependency versions.

## 2. Supabase

1. Visit https://supabase.com/dashboard.
2. Create a project named **tracepilot** in an appropriate **EU region**.
3. Choose a strong database password and save it privately.
4. Open the project's **Connect** panel.
5. Copy the direct PostgreSQL URI for a persistent IPv6-capable backend, or **Session pooler** for IPv4 connectivity.
6. Replace the password placeholder and percent-encode reserved characters in the password.
7. Put the exact URI in the untracked local `.env` as `DATABASE_URL`.

Do not derive a pooler hostname from the region. Supabase's [connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres) explains the available connection methods and the Connect panel. Session pooler is suitable when direct IPv6 connectivity is unavailable. This backend caps its own pool at five connections and disables prepared statements.

Remote connections use TLS with certificate verification. If the platform certificate chain is not trusted by the system, download the project's server root certificate from Supabase Database settings and set `DATABASE_CA_PATH` to its PEM path locally.

For Railway, add `DATABASE_CA_CERT` in the service's Variables tab. Open the certificate file in a text editor and paste its full contents, including `-----BEGIN CERTIFICATE-----`, all certificate lines, and `-----END CERTIFICATE-----`, as the variable's multiline value. Leave `DATABASE_CA_PATH` unset in Railway: a path on your computer does not exist in the container. Choose exactly one certificate source. Railway supports [multiline variables](https://docs.railway.com/variables#multiline-variables). Keep downloaded certificate files out of Git; `.pem`, `.cer` and `.crt` files are ignored. Certificate and hostname verification remain enabled.

Initialize the database from the development environment:

```sh
npm run db:check
npm run db:migrate
npm run db:seed
npm run db:verify
```

`db:check` performs only `SELECT 1`. If it fails, follow the reported code: `EAI_AGAIN` / `ENOTFOUND` indicate DNS lookup failure; `SELF_SIGNED_CERT_IN_CHAIN` or other trust errors require the CA configuration described above; `28P01` indicates database authentication failure. Migration errors report the same safe diagnostics. Do not reset the database or disable certificate verification as a troubleshooting shortcut.

The migration journal makes reapplying migrations repeatable, and seeding uses stable keys with conflict-do-nothing in one transaction. It preserves existing records. Review generated SQL for later changes with `npm run db:generate`. Do not reset production or run destructive migrations automatically. RLS denies Supabase anonymous Data API requests; use the server-only database connection for this backend.

## 3. GitHub

Create a public repository named **tracepilot** with description:

> AI-powered incident investigation engine built with TypeScript, PostgreSQL, OpenAI and MCP.

Once normal Git access and authenticated GitHub CLI access are available:

```sh
git init -b main
git add .
git diff --cached --stat
git diff --cached
npm run verify
git commit -m "Build TracePilot incident investigation backend"
gh repo create tracepilot --public --source=. --remote=origin --push --description "AI-powered incident investigation engine built with TypeScript, PostgreSQL, OpenAI and MCP."
```

Review staged files before committing. `.env`, token files, certificates, `node_modules` and build output must not be staged. The original workspace mounts `.git` read-only; run these commands in a writable clone/workspace after resolving that restriction. Never overwrite another repository's Git metadata to work around it.

CI uses PostgreSQL 17 and a dedicated test connection for migration, persistence and concurrency tests. It must pass before deployment.

## 4. Railway

1. Visit https://railway.com and sign in.
2. Create a project and choose **Deploy from GitHub repo**.
3. Connect the GitHub account if necessary and select `tracepilot`.
4. Generate a public domain in the service's Networking settings. Note the exact domain before setting `PUBLIC_BASE_URL`.
5. Configure private service variables below.
6. Deploy. The included Dockerfile compiles TypeScript and runs `npm start`; `railway.toml` configures the Docker builder and `/health` readiness check.
7. Use the Railway-provided `PORT`. The server binds on host `::`.

| Variable | Production value |
| --- | --- |
| `DATABASE_URL` | Exact Supabase connection URI |
| `DATABASE_CA_CERT` | Full contents of the downloaded Supabase CA certificate, pasted as a multiline value; use for the certificate trust issue encountered locally |
| `DATABASE_CA_PATH` | Leave unset when using `DATABASE_CA_CERT` |
| `ADMIN_API_TOKEN` | First independently generated random secret |
| `MCP_BEARER_TOKEN` | Second independently generated random secret |
| `OPENAI_API_KEY` | Owner's server-side API key, optional while disabled |
| `OPENAI_MODEL` | Supported configurable model, default `gpt-4.1-mini` |
| `ENABLE_AI_INVESTIGATIONS` | **false initially** |
| `MAX_DAILY_INVESTIGATIONS` | 5 |
| `NODE_ENV` | production |
| `PUBLIC_BASE_URL` | `https://` followed by the actual generated domain |
| `EVIDENCE_WINDOW_MINUTES` | 60 |
| `AI_TIMEOUT_MS` | 25000 |

Do not place tokens in GitHub files, a public frontend or URLs. Do not add migration or seed commands to the server start command. Migrate and seed with the externally accessible Supabase connection before deploying, or use a separately controlled one-off job.

## 5. Verify the actual public service

Set your local `PUBLIC_BASE_URL` to the real Railway origin, and configure both owner tokens locally. Keep the server's AI switch off:

```sh
npm run verify:deployment
```

The script checks `/health`, Swagger UI, demo data, labelled snapshot, PostgreSQL mode, the disabled AI flag, anonymous/invalid-token rejection, valid owner REST access and official MCP client initialization/discovery/context invocation over real HTTP. It does not make a paid request by default.

Also use MCP Inspector (`npx @modelcontextprotocol/inspector`) with Streamable HTTP, `/mcp` and the private MCP bearer header. Verify tool discovery, context retrieval and invalid argument handling. Do not equate an HTTP 200 with working MCP.

## 6. One real end-to-end investigation

After security checks pass, set the actual OpenAI key and `ENABLE_AI_INVESTIGATIONS=true` in Railway and redeploy. This is a deliberate owner action. Then:

```sh
ALLOW_AI_ENABLED=true VERIFY_LIVE_AI=true npm run verify:deployment
```

This makes one authenticated REST investigation request, verifies completion and evidence IDs, retrieves the saved result through REST, and retrieves the same investigation through MCP. Any provider correction/retry is capped at two provider calls within the reserved attempt.

Inspect `investigations`, `audit_events` and `daily_usage` in Supabase to confirm the running → completed lifecycle, citation snapshot, model, token usage and audit records. Verify that the configured quota rejects excess requests in the dedicated PostgreSQL test suite; avoid exhausting paid production quota simply to demonstrate the limit.

Return `ENABLE_AI_INVESTIGATIONS=false` if the public portfolio should remain read-only. Failed attempts consume quota conservatively. Do not reset usage to bypass the cost cap. If a process crashes, inspect any remaining `running` record before deciding what to do; there is no automatic replay.

Only after these checks succeed, add the actual GitHub repository, Railway origin, `/docs` and `/mcp` URLs to the README and update `docs/VERIFICATION.md` with the observed results.
