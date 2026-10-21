import { CatalogDataSchema } from '@deeplake/core/contract';
import type { PublishedRecord, PublicDataset, JsonValue } from '@deeplake/core/contract';
import data from '../data/catalog.json';
export const catalog = CatalogDataSchema.parse(data);
export const siteConfig = {
  name: 'Open Atlas',
  baseUrl: process.env.NEXT_PUBLIC_CATALOG_URL ?? 'http://localhost:4174',
  repository: 'https://github.com/Mvgnu/exp',
  facetFields: ['category', 'institution', 'assessment', 'region', 'term'],
  numericFields: ['credits', 'estimatedValue'],
};
export type CatalogEntry = { record: PublishedRecord; dataset: PublicDataset };
export function entries(): CatalogEntry[] {
  return catalog.datasets.flatMap((dataset) =>
    dataset.publication.records.map((record) => ({ record, dataset })),
  );
}
export function valueText(value: JsonValue): string {
  if (value === null) return 'Not established';
  if (Array.isArray(value)) return value.map(valueText).join(', ');
  if (typeof value === 'object')
    return Object.entries(value)
      .map(([key, v]) => `${key}: ${valueText(v)}`)
      .join(' · ');
  if (typeof value === 'number')
    return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value);
  return String(value);
}
export function fieldLabel(dataset: PublicDataset, entityType: string, id: string): string {
  return (
    dataset.schema.entityTypes.find((t) => t.id === entityType)?.fields.find((f) => f.id === id)
      ?.label ?? id
  );
}
export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
export const isDemonstration = catalog.datasets.every((d) => d.project.mode === 'demo');
