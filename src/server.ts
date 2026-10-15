import { buildApp } from './app.js';
import { ConfigurationError, loadEnv } from './config/env.js';

async function main() {
  const env = loadEnv();
  const app = await buildApp({ env });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      const deadline = setTimeout(() => process.exit(1), 10000).unref();
      void app.close().then(() => { clearTimeout(deadline); process.exit(0); });
    });
  }
  await app.listen({ port: env.PORT, host: '::' });
}
main().catch((error: unknown) => {
  // Avoid serializing exceptions containing database URIs or provider request details.
  process.stderr.write(error instanceof ConfigurationError ? `${error.message}\n`
    : 'TracePilot startup failed. Check environment configuration, dependency versions and database connectivity.\n');
  process.exitCode = 1;
});
