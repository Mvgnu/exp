import { createRuntime, loadEnvironment, configuration } from '@deeplake/cli/runtime';
import { runWorker } from '@deeplake/worker';
import { createServer } from './server.js';
loadEnvironment();
const config = configuration();
const runtime = await createRuntime(config);
const server = await createServer({
  ...runtime,
  token: config.token,
  origins: config.origins,
  logging: true,
  providerStatus: {
    exa: Boolean(config.exaKey),
    brave: Boolean(config.braveKey),
    anthropic: Boolean(config.anthropicKey),
    clairic: Boolean(config.cloudflareAccount && config.cloudflareToken),
  },
});
const controller = new AbortController();
let worker: Promise<void> | null = null;
if (!config.databaseUrl)
  worker = runWorker({
    ...runtime,
    signal: controller.signal,
    log: (message) => server.log.info(message),
  });
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  controller.abort();
  await server.close();
  if (worker) await worker;
  await runtime.close();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void shutdown();
  });
await server.listen({ host: config.host, port: config.port });
console.log(
  `Deeplake API ready on http://${config.host}:${config.port}; ${config.databaseUrl ? 'external PostgreSQL workers' : 'embedded local worker'}.`,
);
