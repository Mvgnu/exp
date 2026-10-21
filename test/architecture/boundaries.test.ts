import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir,name);
    if (['node_modules','.next','out','data'].includes(name)) return [];
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|json)$/.test(name) ? [path] : [];
  });
}
const graph: Record<string, string[]> = { core: [], store: ['core'], providers: ['core'], ingest: ['core'], engine: ['core','store','providers','ingest'] };
describe('frozen architecture', () => {
  it('keeps package dependencies directed and domain-neutral', () => {
    for (const [name,allowed] of Object.entries(graph)) {
      for (const path of files(join(root,'packages',name,'src'))) {
        const source=readFileSync(path,'utf8');
        const imports=Array.from(source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g), m=>m[1] ?? '');
        for (const specifier of imports) {
          if (specifier.startsWith('@deeplake/')) expect(allowed,relative(root,path)).toContain(specifier.split('/')[1]);
          expect(specifier,relative(root,path)).not.toMatch(/sites\/|apps\/|fixtures\//);
        }
        expect(source,relative(root,path)).not.toMatch(/curricula\.example|procurement\.example|Northbridge|Riverton/);
        expect(source,relative(root,path)).not.toMatch(/@ts-ignore|as any\b/);
      }
    }
  });
  it('keeps sites on the public read contract without server imports', () => {
    for (const site of ['workbench','catalog']) {
      const manifest=JSON.parse(readFileSync(join(root,'sites',site,'package.json'),'utf8')) as { dependencies: Record<string,string> };
      expect(Object.keys(manifest.dependencies).filter(x=>x.startsWith('@deeplake/'))).toEqual(['@deeplake/core']);
      for (const path of files(join(root,'sites',site))) {
        if (/config|next-env|package.json|tsconfig/.test(path)) continue;
        const source=readFileSync(path,'utf8');
        expect(source,relative(root,path)).not.toMatch(/from ['"](?:@deeplake\/(?:engine|store|providers|ingest)|pg|node:|next\/server)/);
        expect(source,relative(root,path)).not.toMatch(/process\.env\.(?:ANTHROPIC|EXA|CLOUDFLARE|DATABASE|DEEPLAKE_API_TOKEN)/);
      }
    }
  });
  it('requires a spec and external bar for every package and site', () => {
    const paths=[...Object.keys(graph).map(x=>`packages/${x}/SPEC.md`),'specs/sites/workbench.md','specs/sites/catalog.md'];
    for(const p of paths) { const spec=readFileSync(join(root,p),'utf8'); expect(spec).toContain('bar:'); expect(spec).toContain('reference:'); expect(spec).toContain('property:'); }
  });
});
