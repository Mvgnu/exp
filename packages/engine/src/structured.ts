import { JsonValueSchema } from '@deeplake/core';
import type { EntityType, ExtractedValue, JsonValue, Segment } from '@deeplake/core';

function skipSpace(text: string, index: number): number { while (/\s/.test(text[index] ?? '') && index < text.length) index++; return index; }
function stringEnd(text: string, start: number): number {
  let index = start + 1;
  for (; index < text.length; index++) {
    if (text[index] === '\\') { index++; continue; }
    if (text[index] === '"') return index + 1;
  }
  return text.length;
}
function valueEnd(text: string, start: number): number {
  if (text[start] === '"') return stringEnd(text, start);
  if (text[start] === '{' || text[start] === '[') {
    let depth = 0;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (char === '"') { index = stringEnd(text, index) - 1; continue; }
      if (char === '{' || char === '[') depth++;
      if (char === '}' || char === ']') { depth--; if (depth === 0) return index + 1; }
    }
    return text.length;
  }
  let index = start;
  while (index < text.length && text[index] !== ',' && text[index] !== '}') index++;
  while (index > start && /\s/.test(text[index - 1] ?? '')) index--;
  return index;
}

/** Only exact top-level schema field names are mapped. No aliases, coercions, inference or positional joins. */
export function extractStructuredRecord(type: EntityType, segment: Segment): Record<string, ExtractedValue> | null {
  if (segment.warnings.some(warning => /split|truncat/i.test(warning))) return null;
  let parsed: JsonValue;
  try { parsed = JsonValueSchema.parse(JSON.parse(segment.text)); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (!type.identityFields.every(field => Object.hasOwn(parsed, field))) return null;
  const spans = new Map<string, { start: number; end: number }>();
  let index = skipSpace(segment.text, 0) + 1;
  while (index < segment.text.length) {
    index = skipSpace(segment.text, index);
    if (segment.text[index] === '}') break;
    if (segment.text[index] !== '"') return null;
    const keyEnd = stringEnd(segment.text, index);
    const key: unknown = JSON.parse(segment.text.slice(index, keyEnd));
    if (typeof key !== 'string') return null;
    index = skipSpace(segment.text, keyEnd);
    if (segment.text[index] !== ':') return null;
    index = skipSpace(segment.text, index + 1);
    const end = valueEnd(segment.text, index);
    spans.set(key, { start: index, end });
    index = skipSpace(segment.text, end);
    if (segment.text[index] === ',') index++; else if (segment.text[index] !== '}') return null;
  }
  const values: Record<string, ExtractedValue> = {};
  for (const field of type.fields) {
    const span = spans.get(field.id);
    const value = parsed[field.id];
    values[field.id] = span && value !== undefined
      ? { value, confidence: 1, quote: segment.text.slice(span.start, span.end), start: span.start, end: span.end, warnings: [] }
      : { value: null, confidence: null, quote: null, start: null, end: null, warnings: [] };
  }
  return values;
}
