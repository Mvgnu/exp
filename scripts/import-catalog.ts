import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CatalogDataSchema, PublicDatasetSchema } from '@deeplake/core/contract';
const [input, output = 'sites/catalog/data/catalog.json'] = process.argv.slice(2);
if (!input)
  throw new Error('Usage: pnpm exec tsx scripts/import-catalog.ts publication.json [catalog.json]');
const source: unknown = JSON.parse(await readFile(resolve(input), 'utf8'));
const collection = CatalogDataSchema.safeParse(source);
const data = collection.success
  ? collection.data
  : { datasets: [PublicDatasetSchema.parse(source)] };
for (const dataset of data.datasets) {
  if (
    dataset.project.id !== dataset.publication.projectId ||
    dataset.schema.id !== dataset.publication.schemaId ||
    dataset.schema.projectId !== dataset.project.id
  )
    throw new Error('Public dataset contains mismatched project or schema identities');
}
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(resolve(output), JSON.stringify(data, null, 2) + '\n');
console.log(
  `Imported ${data.datasets.length} collections. Build the catalog with pnpm --filter @site/catalog build.`,
);
