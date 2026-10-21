import Ajv from 'ajv';
import { DomainSchemaSchema, JsonValueSchema } from './contract.js';
import type { DomainSchema, FieldDefinition, JsonValue, SchemaChange } from './contract.js';
import { stableStringify } from './canonical.js';

const ajv = new Ajv({ strict: true, allErrors: true, validateFormats: false });

function duplicates(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

export function validateDomainSchema(input: unknown): DomainSchema {
  const schema = DomainSchemaSchema.parse(input);
  duplicates(schema.entityTypes.map(type => type.id), 'entity type identifiers');
  const typeIds = new Set(schema.entityTypes.map(type => type.id));
  for (const type of schema.entityTypes) {
    duplicates(type.fields.map(field => field.id), `fields in ${type.id}`);
    duplicates(type.identityFields, `identity fields in ${type.id}`);
    duplicates(type.scopeFields, `scope fields in ${type.id}`);
    const fields = new Map(type.fields.map(field => [field.id, field]));
    for (const key of [...type.identityFields, ...type.scopeFields]) {
      if (!fields.has(key)) throw new Error(`Unknown identity/scope field ${type.id}.${key}`);
      const field = fields.get(key);
      if (field?.type === 'json' || field?.type === 'list') throw new Error(`Identity/scope field ${type.id}.${key} must be scalar`);
    }
    for (const field of type.fields) {
      if (field.unit && field.type !== 'number') throw new Error(`Only numeric fields carry units: ${type.id}.${field.id}`);
      if (field.type === 'reference' && (!field.targetType || !typeIds.has(field.targetType))) throw new Error(`Unknown reference target for ${type.id}.${field.id}`);
      if (field.type !== 'reference' && field.targetType) throw new Error(`Non-reference field has a target: ${type.id}.${field.id}`);
      if (field.enum) {
        duplicates(field.enum, `enum values for ${type.id}.${field.id}`);
        if (!['text','reference','list'].includes(field.type) || field.enum.length === 0) throw new Error(`Invalid enum for ${type.id}.${field.id}`);
      }
      if (field.type === 'json') {
        if (!field.jsonSchema) throw new Error(`Structured field needs JSON Schema: ${type.id}.${field.id}`);
        // No remote fetch/resolution. AJV only resolves local or preloaded schemas.
        ajv.compile(field.jsonSchema);
      } else if (field.jsonSchema) throw new Error(`Only structured fields carry JSON Schema: ${type.id}.${field.id}`);
    }
  }
  return schema;
}

export function validateFieldValue(field: FieldDefinition, value: unknown): value is JsonValue {
  if (value === null || !JsonValueSchema.safeParse(value).success) return false;
  let valid = false;
  switch (field.type) {
    case 'text': case 'reference': valid = typeof value === 'string' && value.trim().length > 0; break;
    case 'number': valid = typeof value === 'number' && Number.isFinite(value); break;
    case 'boolean': valid = typeof value === 'boolean'; break;
    case 'date': {
      valid = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
      break;
    }
    case 'list': valid = Array.isArray(value) && value.every(item => typeof item === 'string'); break;
    case 'json': {
      if (!field.jsonSchema) return false;
      try { valid = ajv.compile(field.jsonSchema)(value); } catch { return false; }
      break;
    }
  }
  if (valid && field.enum) {
    const allowed = new Set(field.enum);
    valid = typeof value === 'string' ? allowed.has(value) : Array.isArray(value) && value.every(item => typeof item === 'string' && allowed.has(item));
  }
  return valid;
}

export function diffSchemas(beforeInput: DomainSchema, afterInput: DomainSchema): SchemaChange {
  const before = validateDomainSchema(beforeInput);
  const after = validateDomainSchema(afterInput);
  if (before.projectId !== after.projectId) throw new Error('Cannot compare schemas from different projects');
  const changes: string[] = [];
  let breaking = false;
  const record = (text: string, isBreaking = false) => { changes.push(text); breaking ||= isBreaking; };
  const afterTypes = new Map(after.entityTypes.map(type => [type.id,type]));
  for (const previous of before.entityTypes) {
    const next = afterTypes.get(previous.id);
    if (!next) { record(`Remove entity type ${previous.id}`, true); continue; }
    if (stableStringify([...previous.identityFields].sort()) !== stableStringify([...next.identityFields].sort())) record(`Change identity of ${previous.id}`, true);
    if (stableStringify([...previous.scopeFields].sort()) !== stableStringify([...next.scopeFields].sort())) record(`Change applicability of ${previous.id}`, true);
    const nextFields = new Map(next.fields.map(field => [field.id,field]));
    for (const field of previous.fields) {
      const candidate = nextFields.get(field.id);
      if (!candidate) { record(`Remove field ${previous.id}.${field.id}`, true); continue; }
      if (candidate.type !== field.type) record(`Change type of ${previous.id}.${field.id}: ${field.type} → ${candidate.type}`, true);
      if (candidate.unit !== field.unit) record(`Change unit of ${previous.id}.${field.id}`, true);
      if (candidate.targetType !== field.targetType) record(`Change reference target of ${previous.id}.${field.id}`, true);
      if (candidate.required !== field.required) record(`${candidate.required ? 'Require' : 'Make optional'} ${previous.id}.${field.id}`, candidate.required);
      if (stableStringify(candidate.enum ?? null) !== stableStringify(field.enum ?? null)) {
        const narrowed = !!candidate.enum && (!field.enum || field.enum.some(item => !candidate.enum?.includes(item)));
        record(`Change allowed values of ${previous.id}.${field.id}`, narrowed);
      }
      if (stableStringify(candidate.jsonSchema ?? null) !== stableStringify(field.jsonSchema ?? null)) record(`Change structure of ${previous.id}.${field.id}`, true);
      if (candidate.description !== field.description || candidate.label !== field.label) record(`Update guidance for ${previous.id}.${field.id}`);
    }
    for (const field of next.fields) if (!previous.fields.some(old => old.id === field.id)) record(`Add ${field.required ? 'required ' : ''}field ${previous.id}.${field.id}`, field.required);
  }
  for (const type of after.entityTypes) if (!before.entityTypes.some(old => old.id === type.id)) record(`Add entity type ${type.id}`);
  return { breaking, changes };
}
