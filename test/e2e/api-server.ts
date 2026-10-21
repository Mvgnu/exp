import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, FileBlobStore } from '../../packages/store/src/index.js';
import { createEngine } from '../../packages/engine/src/index.js';
import { createParser } from '../../packages/ingest/src/index.js';
import { createServer } from '../../apps/api/src/server.js';
import { createDemoProviders } from '../../apps/cli/src/demo-providers.js';
import { seedDemo } from '../../apps/cli/src/demo.js';

// This local fixture serves the actual API and repository; it never invokes paid providers.
const directory = await mkdtemp(join(tmpdir(), 'deeplake-browser-api-'));
const repository = await createStore({ memory: true });
const blobs = new FileBlobStore(directory);
await seedDemo(repository, blobs);
const engine = createEngine({
  repository,
  blobs,
  parser: createParser(),
  ...(await createDemoProviders()),
});
const server = await createServer({
  repository,
  blobs,
  token: 'browser-test-operator-token-not-a-deployment-secret',
  origins: ['http://127.0.0.1:4173'],
  providerStatus: { exa: false, anthropic: false, clairic: false },
  async getEngine(id) {
    const project = await repository.get('projects', id);
    if (!project || project.mode !== 'demo')
      throw new Error('Live providers are not configured in the browser test fixture.');
    return engine;
  },
});
await server.listen({ host: '127.0.0.1', port: 4311 });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  await repository.close();
  await rm(directory, { recursive: true, force: true });
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void close();
  });
