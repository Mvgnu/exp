import { load } from 'cheerio';
import { Lexer, type Token, type MarkedToken } from 'marked';
import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AcquiredDocument, ParsedDocument, Parser } from '@deeplake/core';
import type { ParseOptions, CollectionEntry } from './contract.js';
import { AcquisitionError, canonicalizeUrl } from './url.js';

const execFileAsync = promisify(execFile);
const PARSER_IMPLEMENTATION = 'deeplake-parser/1.2.0';
function parserVersion(options: Pick<Required<ParseOptions>, 'maxSegmentChars' | 'maxPdfPages'>): string {
  return `${PARSER_IMPLEMENTATION}:${createHash('sha256').update(JSON.stringify([options.maxSegmentChars, options.maxPdfPages])).digest('hex').slice(0,12)}`;
}
export const PARSER_VERSION = parserVersion({ maxSegmentChars: 12_000, maxPdfPages: 200 });
type SegmentInput = ParsedDocument['segments'][number];
interface IsolatedRange { start: number; end: number; label: string; warning?: string }
interface TextInput { title: string; text: string; warnings: string[]; links: string[]; pdf?: boolean; boundaries?: number[]; isolatedRanges?: IsolatedRange[]; records?: Array<{ start: number; end: number; heading: string; context: string }> }
const cleanLine = (text: string) => text.replace(/[\t\r ]+/g, ' ').trim();
const cleanText = (text: string) => text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
function safeLink(value: string, base: string): string | null { try { return canonicalizeUrl(new URL(value, base).toString()); } catch { return null; } }
function decode(document: AcquiredDocument): string {
  const encoding = document.mediaType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] ?? 'utf-8';
  try { return new TextDecoder(encoding, { fatal: true }).decode(document.bytes); }
  catch { throw new AcquisitionError('text_encoding', 'Document text could not be decoded without loss'); }
}
function htmlText(source: string, url: string): TextInput {
  const $ = load(source);
  const title = cleanLine($('title').first().text() || $('h1').first().text() || new URL(url).hostname);
  $('script, style, nav, footer, aside, noscript, iframe, form, svg, canvas, [hidden], [aria-hidden="true"]').remove();
  const root = $('main').first().length ? $('main').first() : $('article').length === 1 ? $('article').first() : $('body');
  const links = [...new Set(root.find('a[href]').toArray().flatMap((node) => { const link = safeLink($(node).attr('href') ?? '', url); return link ? [link] : []; }))];
  // Preserve structural record boundaries through normalization. Markers are
  // collision-checked against decoded source text and never become evidence.
  let markerPrefix = '\uE000DEEPLAKE_RECORD';
  while (source.includes(markerPrefix) || root.text().includes(markerPrefix)) markerPrefix += '_';
  const markers: Array<{ start: string; end: string; label: string; warning?: string }> = [];
  const marker = (label: string, warning?: string) => {
    if (markers.length >= 100_000) throw new AcquisitionError('structure_limit', 'Document exceeds structural record limit');
    const entry = { start: `${markerPrefix}_${markers.length}_START\uE001`, end: `${markerPrefix}_${markers.length}_END\uE001`, label, ...(warning ? { warning } : {}) };
    markers.push(entry);
    return entry;
  };
  root.find('article').each((index, article) => {
    if ($(article).siblings('article').length === 0) return;
    const entry = marker(cleanLine($(article).find('h1,h2,h3,h4,h5,h6').first().text()) || `Article ${index + 1}`);
    $(article).prepend($('<span></span>').text(`\n${entry.start}\n`));
    $(article).append($('<span></span>').text(`\n${entry.end}\n`));
  });
  root.find('ul,ol').each((listIndex, list) => {
    const items = $(list).children('li').toArray();
    if (!items.length) return;
    // A nested list of different singular key:value fields belongs to its owner.
    // Repeated keys, multi-field items, headings and nested lists denote records.
    const fieldKeys = items.map((item) => $(item).find('ul,ol,table,h1,h2,h3,h4,h5,h6').length ? undefined : cleanLine($(item).text()).match(/^([^:;\n]{1,80}):\s*[^:;\n]+$/)?.[1]?.trim().toLowerCase());
    const fields = fieldKeys.every((key) => key !== undefined) && new Set(fieldKeys).size === items.length;
    if (fields && $(list).parents('article,li,tr').length) return;
    items.forEach((item, index) => {
      const entry = marker(cleanLine($(item).find('h1,h2,h3,h4,h5,h6').first().text()) || `List item ${listIndex + 1}.${index + 1}`);
      $(item).before($('<span></span>').text(`\n${entry.start}\n`));
      $(item).after($('<span></span>').text(`\n${entry.end}\n`));
    });
  });
  root.find('br').replaceWith('\n');
  const tables = root.find('table').toArray();
  const layoutTables = new Set(tables.filter((table) => $(table).find('table').length > 0));
  for (const table of tables.reverse()) {
    // An outer layout table must not flatten its nested data tables into one row.
    if (layoutTables.has(table)) { $(table).replaceWith($(table).contents()); continue; }
    const ownRows = $(table).find('tr').toArray().filter((row) => $(row).closest('table').get(0) === table);
    const first = ownRows[0];
    const firstCells = first ? $(first).children('th,td').toArray() : [];
    const header = firstCells.map((cell) => cleanLine($(cell).text()));
    const hasHeader = firstCells.length > 0 && (firstCells.every((cell) => cell.tagName === 'th' && $(cell).attr('scope') !== 'row') || first !== undefined && $(first).parents('thead').length > 0);
    const rows = ownRows.slice(hasHeader ? 1 : 0);
    const caption = cleanLine($(table).children('caption').text());
    const complex = $(table).find('[rowspan],[colspan]').toArray().some((cell) => Number($(cell).attr('rowspan') ?? 1) !== 1 || Number($(cell).attr('colspan') ?? 1) !== 1);
    const warning = complex ? 'table_layout_unsupported: merged cells require explicit layout reconstruction before extraction' : undefined;
    const text = rows.map((row,index) => {
      const cells = $(row).children('td,th').toArray().map((cell) => cleanLine($(cell).text()));
      const label = `Table record ${index + 1}${caption ? ` — ${caption}` : ''}`;
      const entry = marker(label, warning);
      return `\n\n${entry.start}\n### ${label}\n${cells.map((cell,column) => `${hasHeader && !complex ? header[column] || `Column ${column + 1}` : `Column ${column + 1}`}: ${cell}`).join('\n')}\n${entry.end}\n`;
    }).join('');
    $(table).replaceWith($('<div></div>').text(text));
  }
  root.find('h1,h2,h3,h4,h5,h6').each((_, heading) => { const level = Number(heading.tagName.slice(1)); $(heading).replaceWith($('<div></div>').text(`\n\n${'#'.repeat(level)} ${cleanLine($(heading).text())}\n\n`)); });
  root.find('li').each((_, node) => { $(node).prepend('\n- '); $(node).append('\n'); });
  root.find('p,div,section,article,header,dl,dt,dd,pre,blockquote,tr,td,th').each((_, node) => { $(node).prepend('\n'); $(node).append('\n'); });
  const normalized = cleanText(root.text().split('\n').map(cleanLine).join('\n'));
  const isolatedRanges: IsolatedRange[] = [];
  const starts = new Map<number,number>();
  let text = ''; let cursor = 0;
  for (const match of normalized.matchAll(new RegExp(`${markerPrefix}_(\\d+)_(START|END)\uE001`, 'g'))) {
    text += normalized.slice(cursor,match.index);
    const index = Number(match[1]); const entry = markers[index];
    if (entry) {
      if (match[2] === 'START') starts.set(index,text.length);
      else {
        const start = starts.get(index);
        if (start !== undefined) isolatedRanges.push({ start, end: text.length, label: entry.label, ...(entry.warning ? { warning: entry.warning } : {}) });
      }
    }
    cursor = match.index + match[0].length;
  }
  text += normalized.slice(cursor);
  const warnings: string[] = [];
  if (text.length < 40) warnings.push('short_document: little readable source text; inspect acquisition before extracting');
  return { title, text, warnings, links, isolatedRanges };
}
function markdownText(source: string, url: string): TextInput {
  const tokens = new Lexer({ gfm: true }).lex(source);
  const links = new Set<string>();
  const isolatedRanges: IsolatedRange[] = [];
  const boundaries: number[] = [];
  const warnings: string[] = [];
  let text = ''; let title = ''; let count = 0; let listCount = 0; let tableCount = 0;
  const builtIn = (token: Token): token is MarkedToken => ['blockquote','br','checkbox','code','codespan','def','del','em','escape','heading','hr','html','image','link','list','list_item','paragraph','space','strong','table','text'].includes(token.type);
  const visit = (token: Token, depth: number): MarkedToken => {
    if (++count > 100_000 || depth > 100) throw new AcquisitionError('structure_limit', 'Markdown exceeds token or nesting limit');
    if (!builtIn(token)) throw new AcquisitionError('markdown_token', 'Unsupported Markdown token');
    return token;
  };
  const inline = (items: Token[], depth = 0): string => items.map((entry) => {
    const token = visit(entry,depth);
    switch (token.type) {
      case 'strong': case 'em': case 'del': return inline(token.tokens,depth+1);
      case 'link': case 'image': {
        const link = safeLink(token.href,url); if (link) links.add(link);
        return inline(token.tokens,depth+1);
      }
      case 'codespan': case 'escape': return token.text;
      case 'text': return token.tokens ? inline(token.tokens,depth+1) : token.text;
      case 'br': return '\n';
      case 'checkbox': return token.checked ? '[x]' : '[ ]';
      case 'html': return htmlText(token.text,url).text;
      default: return token.raw;
    }
  }).join('');
  const append = (value: string): void => {
    if (text.length + value.length > 50 * 1024 * 1024) throw new AcquisitionError('parse_output_limit', 'Parsed Markdown exceeds output byte limit');
    text += value;
  };
  const isolate = (label: string, render: () => void, warning?: string): void => {
    const start = text.length; render();
    if (text.length > start) isolatedRanges.push({ start, end: text.length, label, ...(warning ? { warning } : {}) });
  };
  const blocks = (items: Token[], owner = false, depth = 0): void => {
    for (const entry of items) {
      const token = visit(entry,depth);
      switch (token.type) {
        case 'space': break;
        case 'heading': {
          const label = cleanLine(inline(token.tokens,depth+1));
          if (!title && token.depth === 1) title = label;
          append(`${'#'.repeat(token.depth)} ${label}\n\n`); break;
        }
        case 'paragraph': case 'text': append(`${token.tokens ? inline(token.tokens,depth+1) : token.text}\n\n`); break;
        case 'list': {
          const listIndex = ++listCount;
          const fieldKeys = token.items.map((item) => item.tokens.some((child) => ['list','table','heading','html','code'].includes(child.type)) ? undefined : cleanLine(inline(new Lexer().inlineTokens(item.text),depth+1)).match(/^([^:;\n]{1,80}):\s*[^:;\n]+$/)?.[1]?.trim().toLowerCase());
          const fields = fieldKeys.every((key) => key !== undefined) && new Set(fieldKeys).size === token.items.length;
          const renderItems = () => token.items.forEach((item,index) => {
            const render = () => { append('- '); blocks(item.tokens,true,depth+1); };
            if (fields && owner) render(); else isolate(`List item ${listIndex}.${index+1}`,render);
          });
          renderItems();
          break;
        }
        case 'table': {
          const tableIndex = ++tableCount;
          const headers = token.header.map((cell) => cleanLine(inline(cell.tokens,depth+1)));
          token.rows.forEach((row,index) => {
            const label = `Table record ${tableIndex}.${index+1}`;
            isolate(label,() => append(`### ${label}\n${row.map((cell,column) => `${headers[column] || `Column ${column+1}`}: ${inline(cell.tokens,depth+1)}`).join('\n')}\n\n`));
          });
          break;
        }
        case 'blockquote': blocks(token.tokens,owner,depth+1); break;
        case 'code': isolate('Code block',() => append(`${token.text}\n\n`),'code_block: literal examples require explicit applicability review before extraction'); break;
        case 'html': {
          const parsed = htmlText(token.text,url); const start = text.length;
          boundaries.push(start);
          append(`${parsed.text}\n\n`);
          boundaries.push(text.length);
          isolatedRanges.push(...(parsed.isolatedRanges ?? []).map((range) => ({ ...range, start: start+range.start, end: start+range.end })));
          parsed.links.forEach((link) => links.add(link));
          break;
        }
        case 'def': { const link = safeLink(token.href,url); if (link) links.add(link); break; }
        case 'hr': boundaries.push(text.length); append('\n'); break;
        default: append(`${inline([token],depth+1)}\n\n`);
      }
    }
  };
  blocks(tokens);
  return { title: title || new URL(url).pathname.split('/').pop() || 'Document', text, warnings, links: [...links], isolatedRanges, boundaries };
}

function isRecord(value: unknown): value is Record<string,unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function stringify(value: unknown): string { return JSON.stringify(value, null, 2); }
function structuredText(value: unknown, title: string): TextInput {
  const records: Array<{ path: string; value: unknown; context: Record<string,unknown> }> = [];
  let visited = 0;
  const walk = (current: unknown, path: string, context: Record<string,unknown>, depth: number): void => {
    if (++visited > 100_000 || depth > 30) throw new AcquisitionError('structure_limit', 'Structured document exceeds nesting or record limit');
    if (Array.isArray(current) && current.length > 0 && current.every(isRecord)) { current.forEach((item,index) => records.push({ path: `${path}[${index}]`, value: item, context })); return; }
    if (isRecord(current)) {
      const metadata = Object.fromEntries(Object.entries(current).filter(([,entry]) => entry === null || ['string','number','boolean'].includes(typeof entry)));
      for (const [key,entry] of Object.entries(current)) if (typeof entry === 'object' && entry !== null) walk(entry, `${path}.${key}`, { ...context, ...metadata }, depth+1);
    }
  };
  walk(value, '$', {}, 0);
  if (!records.length) return { title, text: stringify(value), links: [], warnings: [] };
  let text = '';
  const spans: NonNullable<TextInput['records']> = [];
  for (const record of records) {
    if (text) text += '\n\n';
    const start = text.length;
    text += stringify(record.value);
    spans.push({ start, end: text.length, heading: `Record ${record.path}`, context: `${title} / ${stringify(record.context)}` });
  }
  return { title, text, records: spans, links: [], warnings: [] };
}
function xmlValue(source: string): unknown {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new AcquisitionError('xml_entity', 'XML DTD/entity declarations are not supported');
  const validation = XMLValidator.validate(source);
  if (validation !== true) throw new AcquisitionError('xml_invalid', 'XML is malformed');
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false, parseAttributeValue: false, trimValues: false, processEntities: true }).parse(source) as unknown;
}
async function pdfText(document: AcquiredDocument, options: ParseOptions): Promise<TextInput> {
  const directory = await mkdtemp(join(tmpdir(), 'deeplake-pdf-'));
  const input = join(directory, 'source.pdf');
  const timeout = Math.min(60_000, Math.max(1, options.pdfTimeoutMs ?? 15_000));
  const maxPages = Math.min(1000, Math.max(1, options.maxPdfPages ?? 200));
  try {
    await writeFile(input, document.bytes, { mode: 0o600 });
    const info = await execFileAsync('pdfinfo', [input], { timeout, maxBuffer: 1024*1024, encoding: 'utf8' });
    const pages = Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (!Number.isInteger(pages) || pages < 1) throw new AcquisitionError('pdf_metadata', 'PDF page count could not be read');
    if (pages > maxPages) throw new AcquisitionError('pdf_page_limit', `PDF contains ${pages} pages, above the configured ${maxPages}; explicitly raise the limit or split it`);
    const result = await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', input, '-'], { timeout, maxBuffer: 25 * 1024 * 1024, encoding: 'utf8' });
    const text = result.stdout.replace(/\r\n?/g, '\n').replace(/\f\s*$/, '');
    const warnings = ['pdf_layout: extracted text layout and tables require audit against the original PDF'];
    const emptyPages = text.split('\f').flatMap((page,index) => page.trim().length < 20 ? [index+1] : []);
    if (emptyPages.length) warnings.push(`ocr_required: pages ${emptyPages.join(', ')} have little or no embedded text`);
    return { title: info.stdout.match(/^Title:\s+(.+)$/m)?.[1]?.trim() || new URL(document.url).pathname.split('/').pop() || 'PDF document', text, warnings, links: [], pdf: true };
  } catch (error) {
    if (error instanceof AcquisitionError) throw error;
    const code = isRecord(error) ? error.code : undefined;
    throw new AcquisitionError(code === 'ENOENT' ? 'pdf_tools_missing' : 'pdf_parse_failed', code === 'ENOENT' ? 'Install Poppler (pdfinfo and pdftotext) to parse text PDFs' : 'PDF parsing failed or exceeded its time/output limit');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
function segment(input: TextInput, options: ParseOptions, parserVersion: string): SegmentInput[] {
  const text = input.text;
  if (!text.trim()) return [];
  const max = Math.max(256, Math.min(100_000, options.maxSegmentChars ?? 12_000));
  if (input.records) {
    return input.records.flatMap((record, recordIndex) => {
      const pieces: SegmentInput[] = [];
      for (let start = record.start; start < record.end; start += max) {
        const end = Math.min(record.end, start + max);
        const warnings = record.end - record.start > max ? ['segment_split: structured record exceeds size limit; do not interpret chunks as complete records'] : [];
        pieces.push({ index: recordIndex, text: text.slice(start,end), start, end, heading: record.heading, context: record.context, parserVersion, quality: warnings.length ? 'warning' : 'ok', warnings });
      }
      return pieces;
    }).map((entry,index) => ({ ...entry, index }));
  }
  const headings = [...text.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match) => ({ index: match.index, level: match[1]?.length ?? 1, label: match[2] ?? '', parent: -1 }));
  const hierarchy: typeof headings = [];
  const siblingGroups = new Map<string,typeof headings>();
  for (const heading of headings) {
    while (hierarchy.length && (hierarchy.at(-1)?.level ?? 0) >= heading.level) hierarchy.pop();
    heading.parent = hierarchy.at(-1)?.index ?? -1;
    const key = `${heading.parent}:${heading.level}`;
    const siblings = siblingGroups.get(key) ?? [];
    siblings.push(heading); siblingGroups.set(key,siblings);
    hierarchy.push(heading);
  }
  const boundaries = new Set<number>([0, text.length, ...(input.boundaries ?? [])]);
  for (const range of input.isolatedRanges ?? []) { boundaries.add(range.start); boundaries.add(range.end); }
  for (const siblings of siblingGroups.values()) {
    if (siblings.length < 2) continue;
    for (const heading of siblings) {
      // Explicit sibling articles retain their own descendant sections. A page's
      // shallower wrapper heading must never join multiple articles or headings.
      if (!(input.isolatedRanges ?? []).some((range) => heading.index >= range.start && heading.index < range.end)) boundaries.add(heading.index);
    }
  }
  for (const heading of headings) if (/^Table record /i.test(heading.label)) boundaries.add(heading.index);
  for (const page of text.matchAll(/\f/g)) boundaries.add(page.index + 1);
  const headingByIndex = new Map(headings.map((heading) => [heading.index,heading]));
  const ancestorsAt = (position: number) => {
    const stack: typeof headings = [];
    let low = 0; let high = headings.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((headings[mid]?.index ?? Infinity) <= position) low = mid + 1;
      else high = mid;
    }
    let current = headings[low - 1];
    while (current) { stack.push(current); current = headingByIndex.get(current.parent); }
    return stack.reverse();
  };
  const ordered = [...boundaries].sort((a,b) => a-b);
  const segments: SegmentInput[] = [];
  for (let i=0; i<ordered.length-1; i++) {
    let start = ordered[i] ?? 0; const sectionEnd = ordered[i+1] ?? text.length;

    while (start < sectionEnd) {
      while (start < sectionEnd && /\s/.test(text[start] ?? '')) start++;
      if (start >= sectionEnd) break;
      let end = Math.min(sectionEnd, start+max); const split = end < sectionEnd;
      if (split) { const newline = text.lastIndexOf('\n', end); if (newline > start+Math.floor(max/2)) end = newline; }
      while (end > start && /\s/.test(text[end-1] ?? '')) end--;
      if (end <= start) end = Math.min(sectionEnd, start+max);
      const warnings = [...input.warnings];
      if (split || start > (ordered[i] ?? 0) + max) warnings.push('segment_split: a source section exceeded the size limit; identity/context must be audited');
      const ancestry = ancestorsAt(start).filter((entry) => !(input.isolatedRanges ?? []).some((range) => !(start >= range.start && start < range.end) && entry.index >= range.start && entry.index < range.end));
      const enclosingRanges = (input.isolatedRanges ?? []).filter((range) => start >= range.start && start < range.end);
      const enclosing = enclosingRanges.sort((a,b) => (a.end-a.start) - (b.end-b.start))[0];
      for (const range of enclosingRanges) if (range.warning) warnings.push(range.warning);
      const leaf = ancestry.at(-1);
      const heading = leaf && /^Table record /i.test(leaf.label) ? leaf.label : enclosing?.label ?? leaf?.label ?? input.title;
      const ancestors = ancestry.filter((entry) => entry.label !== heading);
      const context = [input.title, ...ancestors.map((entry) => entry.label)].filter((entry,index,all) => Boolean(entry) && all.indexOf(entry) === index).join(' / ');
      const value = text.slice(start,end);
      const blocked = enclosingRanges.some((range) => range.warning !== undefined) || !/[\p{L}\p{N}]/u.test(value) || (input.pdf && value.trim().length < 20);
      segments.push({ index: segments.length, text: value, heading, start, end, context, parserVersion, quality: blocked ? 'blocked' : warnings.length ? 'warning' : 'ok', warnings, ...(input.pdf ? { page: text.slice(0,start).split('\f').length } : {}) });
      start = end;
    }
  }
  return segments;
}
export function createParser(options: ParseOptions = {}): Parser {
  const limit = (value: number | undefined, fallback: number, min: number, max: number): number => {
    if (value !== undefined && !Number.isFinite(value)) throw new AcquisitionError('parse_options', 'Parser limits must be finite numbers');
    return Math.floor(Math.max(min,Math.min(max,value ?? fallback)));
  };
  const effective = {
    maxSegmentChars: limit(options.maxSegmentChars,12_000,256,100_000),
    maxPdfPages: limit(options.maxPdfPages,200,1,1000),
    pdfTimeoutMs: limit(options.pdfTimeoutMs,15_000,1,60_000),
  };
  const version = parserVersion(effective);
  return { async parse(document): Promise<ParsedDocument> {
    if (document.notModified || document.status === 304) throw new AcquisitionError('unchanged_document', 'A 304 response has no new content to parse');
    if (document.bytes.byteLength > 50 * 1024 * 1024) throw new AcquisitionError('parse_byte_limit', 'Document exceeds parser byte limit');
    const mime = document.mediaType.split(';')[0]?.trim().toLowerCase() ?? '';
    const magic = new TextDecoder().decode(document.bytes.slice(0, 8));
    let input: TextInput;
    if (mime === 'application/pdf' || magic.startsWith('%PDF-')) input = await pdfText(document, effective);
    else {
      const source = decode(document);
      if (mime.includes('html') || /^\s*<!doctype html|^\s*<html/i.test(source)) input = htmlText(source, document.url);
      else if (mime.includes('json')) {
        let value: unknown; try { value = JSON.parse(source) as unknown; } catch { throw new AcquisitionError('json_invalid', 'JSON is malformed'); }
        input = structuredText(value, 'Structured document');
      } else if (mime.includes('xml') || /^\s*<\?xml/.test(source)) input = structuredText(xmlValue(source), 'XML document');
      else if (mime.startsWith('text/') || mime === 'application/octet-stream' && !source.includes('\0')) input = markdownText(source,document.url);
      else throw new AcquisitionError('unsupported_media', `Unsupported document media type: ${mime || 'unknown'}`);
    }
    if (!input.text.trim()) input.warnings.push('empty_document: no readable text; acquire a better artifact or use OCR');
    return { title: input.title, text: input.text, warnings: input.warnings, links: input.links, parserVersion: version, segments: segment(input, effective, version) };
  } };
}
export function enumerateCollection(document: AcquiredDocument): CollectionEntry[] {
  const mime = document.mediaType.toLowerCase();
  const source = decode(document);
  const entries: CollectionEntry[] = [];
  if (mime.includes('xml') || /^\s*<\?xml/.test(source)) {
    const value = xmlValue(source);
    const visit = (node: unknown, depth: number): void => {
      if (depth > 30 || entries.length >= 10_000) return;
      if (Array.isArray(node)) node.forEach((child) => visit(child,depth+1));
      else if (isRecord(node)) for (const [key,child] of Object.entries(node)) {
        if (key === 'loc' && typeof child === 'string') { const url = safeLink(child.trim(), document.url); if (url) entries.push({ url, title: url, family: 'sitemap' }); }
        else visit(child,depth+1);
      }
    }; visit(value,0);
  } else if (mime.includes('html')) {
    const $ = load(source); $('nav,footer,script,style').remove();
    $('main a[href], article a[href], body > a[href], li a[href], td a[href]').slice(0, 10_000).each((_, node) => {
      const url = safeLink($(node).attr('href') ?? '', document.url); if (url) entries.push({ url, title: cleanLine($(node).text()) || url, family: 'collection' });
    });
  } else if (mime.includes('json')) {
    let value: unknown; try { value = JSON.parse(source) as unknown; } catch { throw new AcquisitionError('json_invalid', 'JSON collection is malformed'); }
    const visit = (node: unknown, depth: number): void => {
      if (depth > 30 || entries.length >= 10_000) return;
      if (Array.isArray(node)) node.forEach((child) => visit(child,depth+1));
      else if (isRecord(node)) {
        const link = typeof node.url === 'string' ? node.url : typeof node.href === 'string' ? node.href : null;
        if (link) { const url = safeLink(link,document.url); if (url) entries.push({ url, title: typeof node.title === 'string' ? node.title : url, family: 'api-collection' }); }
        for (const child of Object.values(node)) if (typeof child === 'object') visit(child,depth+1);
      }
    }; visit(value,0);
  }
  return [...new Map(entries.map((entry) => [entry.url,entry])).values()];
}
