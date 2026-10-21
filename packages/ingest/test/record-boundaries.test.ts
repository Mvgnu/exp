import { describe, expect, it } from 'vitest';
import type { AcquiredDocument, ParsedDocument } from '@deeplake/core';
import { createParser, PARSER_VERSION } from '../src/index.js';

const a = 'SKU: A-1; Batch: 2026; Capacity: 10 units';
const b = 'SKU: B-1; Batch: 2027; Capacity: 20 units';
const document = (source: string, mediaType: string): AcquiredDocument => ({ url: 'https://example.org/inventory', status: 200, bytes: new TextEncoder().encode(source), mediaType, headers: {}, acquiredAt: '2026-10-21T12:00:00Z', acquisition: 'fixture', notModified: false });
const html = (body: string) => `<title>Inventory</title><main><h1>Warehouse lots</h1>${body}</main>`;
const table = '<table><tr><th>SKU</th><th>Batch</th><th>Capacity</th></tr><tr><td>A-1</td><td>2026</td><td>10 units</td></tr><tr><td>B-1</td><td>2027</td><td>20 units</td></tr></table>';

// An adversarial extractor may choose the first identity but the last quantity.
// Every quote remains exact. Structural isolation must still give the two right
// records rather than allowing A's identity to borrow B's last quantity.
function firstIdentityLastCapacity(parsed: ParsedDocument) {
  return parsed.segments.flatMap((segment) => {
    expect(parsed.text.slice(segment.start,segment.end)).toBe(segment.text);
    const sku = segment.text.match(/SKU:\s*([AB]-1)/);
    const batch = segment.text.match(/Batch:\s*(202[67])/);
    const capacity = [...segment.text.matchAll(/Capacity:\s*(\d+) units/g)].at(-1);
    if (!sku || !batch || !capacity) return [];
    for (const quote of [sku[0],batch[0],capacity[0]]) {
      const start = segment.text.indexOf(quote);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(segment.text.slice(start,start+quote.length)).toBe(quote);
    }
    expect(segment.quality).toBe('ok');
    return [{ sku: sku[1], batch: batch[1], capacity: Number(capacity[1]) }];
  });
}
const expected = [{ sku: 'A-1', batch: '2026', capacity: 10 },{ sku: 'B-1', batch: '2027', capacity: 20 }];
const cases = [
  { name: 'HTML unordered list', mime: 'text/html', body: html(`<ul><li>${a}</li><li>${b}</li></ul>`) },
  { name: 'HTML ordered list', mime: 'text/html', body: html(`<ol><li>${a}</li><li>${b}</li></ol>`) },
  { name: 'HTML paragraph list items', mime: 'text/html', body: html(`<ul><li><p>${a}</p></li><li><p>${b}</p></li></ul>`) },
  { name: 'HTML article list records', mime: 'text/html', body: html(`<article><h2>Items</h2><ul><li>${a}</li><li>${b}</li></ul></article>`) },
  { name: 'Markdown numbered list', mime: 'text/markdown', body: `# Warehouse lots\n\n1. ${a}\n2. ${b}` },
  { name: 'Markdown unordered list', mime: 'text/markdown', body: `# Warehouse lots\n\n- ${a}\n- ${b}` },
  { name: 'Markdown loose multiline list', mime: 'text/markdown', body: `# Warehouse lots\n\n1. SKU: A-1\n   Batch: 2026\n   Capacity: 10 units\n\n2. SKU: B-1\n   Batch: 2027\n   Capacity: 20 units` },
  { name: 'Markdown nested field lists', mime: 'text/markdown', body: '# Warehouse lots\n\n- Widget A\n  - SKU: A-1\n  - Batch: 2026\n  - Capacity: 10 units\n- Widget B\n  - SKU: B-1\n  - Batch: 2027\n  - Capacity: 20 units' },
  { name: 'Markdown quoted list', mime: 'text/markdown', body: `# Warehouse lots\n\n> 1. ${a}\n> 2. ${b}` },
  { name: 'HTML table', mime: 'text/html', body: html(table) },
  { name: 'HTML data table inside layout table', mime: 'text/html', body: html(`<table><tr><td>${table}</td></tr></table>`) },
  { name: 'Markdown table', mime: 'text/markdown', body: '# Warehouse lots\n\n| SKU | Batch | Capacity |\n| --- | --- | --- |\n| A-1 | 2026 | 10 units |\n| B-1 | 2027 | 20 units |' },
  { name: 'Markdown aligned table without outer pipes', mime: 'text/markdown', body: '# Warehouse lots\n\nSKU | Batch | Capacity\n:--- | ---: | :---:\nA-1 | 2026 | 10 units\nB-1 | 2027 | 20 units' },
];

describe('Exact evidence stays bound to structural records', () => {
  it.each(cases)('$name',async({body,mime}) => {
    const parsed = await createParser().parse(document(body,mime));
    expect(firstIdentityLastCapacity(parsed)).toEqual(expected);
    for (const segment of parsed.segments) expect(segment.text.includes('A-1') && segment.text.includes('B-1')).toBe(false);
  });
  it('keeps a nested field list with its own sibling article',async() => {
    const source = html('<article><h2>Widget A</h2><ul><li>SKU: A-1</li><li>Batch: 2026</li><li>Capacity: 10 units</li></ul></article><article><h2>Widget B</h2><ul><li>SKU: B-1</li><li>Batch: 2027</li><li>Capacity: 20 units</li></ul></article>');
    const parsed = await createParser().parse(document(source,'text/html'));
    expect(firstIdentityLastCapacity(parsed)).toEqual(expected);
    expect(parsed.segments.find((segment) => segment.text.includes('B-1'))?.context).not.toContain('Widget A');
  });
  it('does not mistake distinct top-level item labels for fields of one record',async() => {
    for (const [mime,source] of [['text/html',html('<ul><li>Widget A: 10 units</li><li>Widget B: 20 units</li></ul>')],['text/markdown','# Inventory\n\n- Widget A: 10 units\n- Widget B: 20 units']]) {
      const parsed = await createParser().parse(document(source ?? '',mime ?? 'text/plain'));
      expect(parsed.segments.some((segment) => segment.text.includes('Widget A') && segment.text.includes('Widget B'))).toBe(false);
    }
  });
  it('ends a table record before following source prose',async() => {
    const parsed = await createParser().parse(document(html(`${table}<p>SKU: C-1; Batch: 2028; Capacity: 30 units</p>`),'text/html'));
    const last = parsed.segments.find((segment) => segment.text.includes('B-1'));
    expect(last?.text).not.toContain('C-1');
    expect(parsed.segments.find((segment) => segment.text.includes('C-1'))?.heading).not.toContain('Table record');
  });
  it('blocks merged-cell tables instead of guessing a column-to-record mapping',async() => {
    const parsed = await createParser().parse(document(html('<table><tr><th>SKU</th><th>Capacity</th></tr><tr><td rowspan="2">A-1</td><td>10 units</td></tr><tr><td>20 units</td></tr></table>'),'text/html'));
    const rows = parsed.segments.filter((segment) => segment.heading.startsWith('Table record'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((segment) => segment.quality === 'blocked' && segment.warnings.some((warning) => warning.startsWith('table_layout_unsupported:')))).toBe(true);
  });
  it('keeps literal code examples out of supported record extraction',async() => {
    const parsed = await createParser().parse(document(`# Inventory\n\n\`\`\`text\n1. ${a}\n2. ${b}\n\`\`\``,'text/markdown'));
    const examples = parsed.segments.filter((segment) => segment.text.includes('A-1'));
    expect(examples).toHaveLength(1);
    expect(examples.every((segment) => segment.quality === 'blocked')).toBe(true);
  });
  it('includes effective parse options in a stable immutable version identity',async() => {
    const source = document('x'.repeat(1000),'text/plain');
    const defaults = await createParser().parse(source);
    const explicitDefaults = await createParser({maxSegmentChars:12000,maxPdfPages:200,pdfTimeoutMs:1}).parse(source);
    const smaller = await createParser({maxSegmentChars:256}).parse(source);
    const morePdfPages = await createParser({maxPdfPages:300}).parse(source);
    const sameEffective = await createParser({maxSegmentChars:1}).parse(source);
    expect(defaults.parserVersion).toBe(PARSER_VERSION);
    expect(explicitDefaults.parserVersion).toBe(defaults.parserVersion);
    expect(smaller.parserVersion).not.toBe(defaults.parserVersion);
    expect(morePdfPages.parserVersion).not.toBe(defaults.parserVersion);
    expect(sameEffective.parserVersion).toBe(smaller.parserVersion);
    expect(smaller.segments.every((segment) => segment.parserVersion === smaller.parserVersion)).toBe(true);
    expect(smaller.segments.length).toBeGreaterThan(defaults.segments.length);
  });
});
