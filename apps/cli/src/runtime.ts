import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { createStore, FileBlobStore } from '@deeplake/store';
import { createEngine } from '@deeplake/engine';
import { createAcquirer, createParser } from '@deeplake/ingest';
import {
  createAnthropicReasoner,
  createBraveSearch,
  createClairicExtractor,
  createExaSearch,
} from '@deeplake/providers';
import type { Engine } from '@deeplake/engine';
import type { Repository, BlobStore } from '@deeplake/store';
import { createDemoProviders, repositoryRoot } from './demo-providers.js';
import { withContentsFallback } from './acquisition.js';

const ConfigurationSchema = z.object({
  dataDir: z.string(),
  databaseUrl: z.string().optional(),
  token: z.string(),
  host: z.string(),
  port: z.coerce.number().int().min(1).max(65535),
  origins: z.array(z.string().url()),
  exaContentsFallback: z.boolean(),
  searchProvider: z.enum(['exa', 'brave']),
  exaMode: z.enum(['auto', 'lite']),
  exaKey: z.string(),
  braveKey: z.string(),
  anthropicKey: z.string(),
  cloudflareAccount: z.string(),
  cloudflareToken: z.string(),
  models: z.object({
    planner: z.string(),
    architect: z.string(),
    auditor: z.string(),
    resolver: z.string(),
  }),
  inputPrice: z.coerce.number().nonnegative(),
  outputPrice: z.coerce.number().nonnegative(),
  clairicPrice: z.coerce.number().nonnegative(),
  userAgent: z.string(),
});
export type Configuration = z.infer<typeof ConfigurationSchema>;
export function configuration(env: NodeJS.ProcessEnv = process.env): Configuration {
  return ConfigurationSchema.parse({
    dataDir: resolve(repositoryRoot, env.DEEPLAKE_DATA_DIR ?? '.deeplake'),
    databaseUrl: env.DATABASE_URL || undefined,
    token: env.DEEPLAKE_API_TOKEN ?? '',
    host: env.DEEPLAKE_HOST ?? '127.0.0.1',
    port: env.DEEPLAKE_PORT ?? 4310,
    origins: (
      env.DEEPLAKE_CORS_ORIGINS ??
      'http://localhost:3000,http://127.0.0.1:3000,http://127.0.0.1:4173'
    )
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    exaContentsFallback: env.EXA_CONTENTS_FALLBACK === 'true',
    searchProvider: env.SEARCH_PROVIDER ?? 'exa',
    exaMode: env.EXA_SEARCH_MODE ?? 'auto',
    exaKey: env.EXA_API_KEY ?? '',
    braveKey: env.BRAVE_API_KEY ?? '',
    anthropicKey: env.ANTHROPIC_API_KEY ?? '',
    cloudflareAccount: env.CLOUDFLARE_ACCOUNT_ID ?? '',
    cloudflareToken: env.CLOUDFLARE_API_TOKEN ?? '',
    models: {
      planner: env.MODEL_PLANNER ?? 'claude-haiku-5-5',
      architect: env.MODEL_ARCHITECT ?? 'claude-opus-5-5',
      auditor: env.MODEL_AUDITOR ?? 'claude-sonnet-5-5',
      resolver: env.MODEL_RESOLVER ?? 'claude-sonnet-5-5',
    },
    inputPrice: env.LLM_INPUT_USD_PER_MILLION ?? 4,
    outputPrice: env.LLM_OUTPUT_USD_PER_MILLION ?? 20,
    clairicPrice: env.CLAIRIC_INPUT_USD_PER_MILLION ?? 0.1,
    userAgent: env.DEEPLAKE_USER_AGENT ?? 'Deeplake/0.1',
  });
}
export function loadEnvironment(): void {
  const path = resolve(repositoryRoot, '.env');
  if (existsSync(path)) process.loadEnvFile(path);
}
export interface Runtime {
  repository: Repository;
  blobs: BlobStore;
  config: Configuration;
  getEngine(projectId: string): Promise<Engine>;
  close(): Promise<void>;
}
export async function createRuntime(config = configuration()): Promise<Runtime> {
  const repository = await createStore({
    databaseUrl: config.databaseUrl,
    dataDir: resolve(config.dataDir, 'db'),
  });
  const blobs = new FileBlobStore(resolve(config.dataDir, 'blobs'));
  const engines = new Map<string, Engine>();
  return {
    repository,
    blobs,
    config,
    async getEngine(projectId) {
      const project = await repository.get('projects', projectId);
      if (!project) throw new Error('Project not found');
      const cached = engines.get(project.mode);
      if (cached) return cached;
      const parser = createParser();
      let engine: Engine;
      if (project.mode === 'demo') {
        const providers = await createDemoProviders();
        engine = createEngine({ repository, blobs, parser, ...providers });
      } else {
        const missing = [
          !config.anthropicKey && 'ANTHROPIC_API_KEY',
          !config.cloudflareAccount && 'CLOUDFLARE_ACCOUNT_ID',
          !config.cloudflareToken && 'CLOUDFLARE_API_TOKEN',
          config.searchProvider === 'exa' && !config.exaKey && 'EXA_API_KEY',
          config.searchProvider === 'brave' && !config.braveKey && 'BRAVE_API_KEY',
        ].filter(Boolean);
        if (missing.length)
          throw new Error(
            `Live providers are not configured: ${missing.join(', ')}. No demonstration fallback was used.`,
          );
        const exa = config.exaKey
          ? createExaSearch({ apiKey: config.exaKey, mode: config.exaMode })
          : undefined;
        const search =
          config.searchProvider === 'brave' ? createBraveSearch({ apiKey: config.braveKey }) : exa;
        if (!search) throw new Error('Search provider is unavailable.');
        const primary = createAcquirer({ userAgent: config.userAgent, respectRobots: true });
        const acquirer = withContentsFallback(
          primary,
          config.exaContentsFallback && exa ? (url) => exa.contents(url) : undefined,
        );
        engine = createEngine({
          repository,
          blobs,
          parser,
          search,
          acquirer,
          reasoner: createAnthropicReasoner({
            apiKey: config.anthropicKey,
            models: config.models,
            inputUsdPerMillion: config.inputPrice,
            outputUsdPerMillion: config.outputPrice,
          }),
          extractor: createClairicExtractor({
            accountId: config.cloudflareAccount,
            apiToken: config.cloudflareToken,
            inputUsdPerMillion: config.clairicPrice,
          }),
        });
      }
      engines.set(project.mode, engine);
      return engine;
    },
    close: () => repository.close(),
  };
}
