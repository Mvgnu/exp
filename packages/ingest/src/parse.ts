import { load } from 'cheerio';
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
export const PARSER_VERSION = 'deeplake-parser/1.1.0';
type SegmentInput = ParsedDocument['segments'][number];
interface TextInput { title: string; text: string; warnings: string[]; links: string[]; pdf?: boolean; isolatedRanges?: Array<{ start: number; end: number; label: string }>; records?: Array<{ start: number; end: number; heading: string; context: string }> }
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
  // Article boundaries are stronger than heading heuristics. Preserve them through
  // text normalization without adding synthetic evidence to the final artifact.
  let markerPrefix = '\uE000DEEPLAKE_RECORD';
  while (source.includes(markerPrefix)) markerPrefix += '_';
  const articleMarkers: Array<{ start: string; end: string; label: string }> = [];
  root.find('article').each((index, article) => {
    if ($(article).siblings('article').length === 0) return;
    const start = `${markerPrefix}_${index}_START\uE001`;
    const end = `${markerPrefix}_${index}_END\uE001`;
    const label = cleanLine($(article).find('h1,h2,h3,h4,h5,h6').first().text()) || `Article ${index + 1}`;
    articleMarkers.push({ start, end, label });
    $(article).prepend($('<span></span>').text(`\n${start}\n`));
    $(article).append($('<span></span>').text(`\n${end}\n`));
  });
  root.find('br').replaceWith('\n');
  root.find('table').each((_, table) => {
    const header = $(table).find('tr').first().find('th,td').toArray().map((cell) => cleanLine($(cell).text()));
    const hasHeader = $(table).find('tr').first().find('th').length > 0;
    const rows = $(table).find('tr').toArray().slice(hasHeader ? 1 : 0);
    const caption = cleanLine($(table).find('caption').text());
    const text = rows.map((row,index) => {
      const cells = $(row).find('td,th').toArray().map((cell) => cleanLine($(cell).text()));
      return `\n\n### Table record ${index + 1}${caption ? ` — ${caption}` : ''}\n${cells.map((cell,column) => `${hasHeader ? header[column] || `Column ${column + 1}` : `Column ${column + 1}`}: ${cell}`).join('\n')}\n`;
    }).join('');
    $(table).replaceWith($('<div></div>').text(text));
  });
  root.find('h1,h2,h3,h4,h5,h6').each((_, heading) => { const level = Number(heading.tagName.slice(1)); $(heading).replaceWith($('<div></div>').text(`\n\n${'#'.repeat(level)} ${cleanLine($(heading).text())}\n\n`)); });
  root.find('li').each((_, node) => { $(node).prepend('\n- '); $(node).append('\n'); });
  root.find('p,div,section,article,header,dl,dt,dd,pre,blockquote').each((_, node) => { $(node).prepend('\n'); $(node).append('\n'); });
  let text = cleanText(root.text().split('\n').map(cleanLine).join('\n'));
  const isolatedRanges: NonNullable<TextInput['isolatedRanges']> = [];
  const occurrences = articleMarkers.flatMap((marker) => [
    { token: marker.start, offset: text.indexOf(marker.start), opening: true, marker },
    { token: marker.end, offset: text.indexOf(marker.end), opening: false, marker },
  ]).filter((entry) => entry.offset >= 0).sort((a,b) => a.offset - b.offset);
  const starts = new Map<string,number>();
  let removed = 0;
  for (const occurrence of occurrences) {
    const position = occurrence.offset - removed;
    text = text.slice(0,position) + text.slice(position + occurrence.token.length);
    removed += occurrence.token.length;
    if (occurrence.opening) starts.set(occurrence.marker.start,position);
    else {
      const start = starts.get(occurrence.marker.start);
      if (start !== undefined) isolatedRanges.push({ start, end: position, label: occurrence.marker.label });
    }
  }
  const warnings: string[] = [];
  if (text.length < 40) warnings.push('short_document: little readable source text; inspect acquisition before extracting');
  return { title, text, warnings, links, isolatedRanges };
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
function segment(input: TextInput, options: ParseOptions): SegmentInput[] {
  const text = input.text;
  if (!text.trim()) return [];
  const max = Math.max(256, Math.min(100_000, options.maxSegmentChars ?? 12_000));
  if (input.records) {
    return input.records.flatMap((record, recordIndex) => {
      const pieces: SegmentInput[] = [];
      for (let start = record.start; start < record.end; start += max) {
        const end = Math.min(record.end, start + max);
        const warnings = record.end - record.start > max ? ['segment_split: structured record exceeds size limit; do not interpret chunks as complete records'] : [];
        pieces.push({ index: recordIndex, text: text.slice(start,end), start, end, heading: record.heading, context: record.context, parserVersion: PARSER_VERSION, quality: warnings.length ? 'warning' : 'ok', warnings });
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
  const boundaries = new Set<number>([0, text.length]);
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
  const ancestorsAt = (position: number) => {
    const stack: typeof headings = [];
    for (const heading of headings) {
      if (heading.index > position) break;
      while (stack.length && (stack.at(-1)?.level ?? 0) >= heading.level) stack.pop();
      stack.push(heading);
    }
    return stack;
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
      const ancestry = ancestorsAt(start);
      const enclosing = (input.isolatedRanges ?? []).filter((range) => start >= range.start && start < range.end).at(-1);
      const leaf = ancestry.at(-1);
      const heading = leaf && /^Table record /i.test(leaf.label) ? leaf.label : enclosing?.label ?? leaf?.label ?? input.title;
      const ancestors = ancestry.filter((entry) => entry.label !== heading && !(input.isolatedRanges ?? []).some((range) => range !== enclosing && entry.index >= range.start && entry.index < range.end));
      const context = [input.title, ...ancestors.map((entry) => entry.label)].filter((entry,index,all) => Boolean(entry) && all.indexOf(entry) === index).join(' / ');
      const value = text.slice(start,end);
      const blocked = !/[\p{L}\p{N}]/u.test(value) || (input.pdf && value.trim().length < 20);
      segments.push({ index: segments.length, text: value, heading, start, end, context, parserVersion: PARSER_VERSION, quality: blocked ? 'blocked' : warnings.length ? 'warning' : 'ok', warnings, ...(input.pdf ? { page: text.slice(0,start).split('\f').length } : {}) });
      start = end;
    }
  }
  return segments;
}
export function createParser(options: ParseOptions = {}): Parser {
  return { async parse(document): Promise<ParsedDocument> {
    if (document.notModified || document.status === 304) throw new AcquisitionError('unchanged_document', 'A 304 response has no new content to parse');
    if (document.bytes.byteLength > 50 * 1024 * 1024) throw new AcquisitionError('parse_byte_limit', 'Document exceeds parser byte limit');
    const mime = document.mediaType.split(';')[0]?.trim().toLowerCase() ?? '';
    const magic = new TextDecoder().decode(document.bytes.slice(0, 8));
    let input: TextInput;
    if (mime === 'application/pdf' || magic.startsWith('%PDF-')) input = await pdfText(document, options);
    else {
      const source = decode(document);
      if (mime.includes('html') || /^\s*<!doctype html|^\s*<html/i.test(source)) input = htmlText(source, document.url);
      else if (mime.includes('json')) {
        let value: unknown; try { value = JSON.parse(source) as unknown; } catch { throw new AcquisitionError('json_invalid', 'JSON is malformed'); }
        input = structuredText(value, 'Structured document');
      } else if (mime.includes('xml') || /^\s*<\?xml/.test(source)) input = structuredText(xmlValue(source), 'XML document');
      else if (mime.startsWith('text/') || mime === 'application/octet-stream' && !source.includes('\0')) input = { title: source.match(/^#\s+(.+)$/m)?.[1] ?? new URL(document.url).pathname.split('/').pop() ?? 'Document', text: cleanText(source), warnings: [], links: [] };
      else throw new AcquisitionError('unsupported_media', `Unsupported document media type: ${mime || 'unknown'}`);
    }
    if (!input.text.trim()) input.warnings.push('empty_document: no readable text; acquire a better artifact or use OCR');
    return { title: input.title, text: input.text, warnings: input.warnings, links: input.links, parserVersion: PARSER_VERSION, segments: segment(input, options) };
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
