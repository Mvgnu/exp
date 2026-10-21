import { createRuntime, loadEnvironment, configuration } from '@deeplake/cli/runtime';
import { runWorker } from './loop.js';
loadEnvironment();
const config = configuration();
if (!config.databaseUrl)
  throw new Error(
    'Standalone workers require DATABASE_URL. Local PGlite runs one embedded worker in pnpm api.',
  );
const runtime = await createRuntime(config);
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => controller.abort());
try {
  await runWorker({
    repository: runtime.repository,
    getEngine: runtime.getEngine,
    signal: controller.signal,
    log: console.log,
  });
} finally {
  await runtime.close();
}
