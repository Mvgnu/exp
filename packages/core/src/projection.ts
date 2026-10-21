import { EvidenceSchema, PublicationSchema } from './contract.js';
import type { Evidence, Observation, ProjectionInput, Publication, PublishedField, PublishedRecord, Segment } from './contract.js';
import { normalizeScope, stableId, stableStringify } from './canonical.js';
import { validateDomainSchema, validateFieldValue } from './schema.js';

/** Evidence offsets are half-open UTF-16 offsets relative to the stored segment text. */
export function validateEvidence(input: Evidence, segment: Segment): boolean {
  const result = EvidenceSchema.safeParse(input);
  if (!result.success || segment.quality === 'blocked') return false;
  const evidence = result.data;
  return evidence.sourceVersionId === segment.sourceVersionId && evidence.segmentId === segment.id && evidence.end > evidence.start && evidence.end <= segment.text.length && segment.text.slice(evidence.start,evidence.end) === evidence.quote && (evidence.page === undefined || evidence.page === segment.page);
}

export function buildPublication(input: ProjectionInput): Publication {
  const schema = validateDomainSchema(input.schema);
  if (schema.projectId !== input.project.id || input.project.currentSchemaId !== schema.id) throw new Error('Publication requires the project’s approved current schema');
  if (input.previous && input.previous.projectId !== input.project.id) throw new Error('Previous release belongs to a different project');
  const segments = new Map(input.segments.filter(segment => segment.projectId === input.project.id).map(segment => [segment.id,segment]));
  const versions = new Map(input.sourceVersions.filter(version => version.projectId === input.project.id).map(version => [version.id,version]));
  const sources = new Map(input.sources.filter(source => source.projectId === input.project.id).map(source => [source.id,source]));
  const latestBySource = new Map<string,string>();
  for (const source of sources.values()) {
    if (!source.latestVersionId) continue;
    const version = versions.get(source.latestVersionId);
    if (!version || version.sourceId !== source.id) throw new Error(`Missing or invalid current source version for ${source.id}`);
    latestBySource.set(source.id, version.id);
  }
  const types = new Map(schema.entityTypes.map(type => [type.id,type]));
  const openFindings = input.findings.filter(finding => finding.projectId === input.project.id && finding.status === 'open');
  const records: PublishedRecord[] = [];
  const included: Observation[] = [];
  let withheld = 0;
  for (const entity of [...input.entities].filter(entity => entity.projectId === input.project.id).sort((a,b) => a.id.localeCompare(b.id))) {
    const type = types.get(entity.type);
    if (!type) continue;
    const scope = stableStringify(normalizeScope(entity.scope));
    const fields: Record<string,PublishedField> = {};
    const warnings: string[] = [];
    const eligible = input.observations.filter(observation => observation.entityId === entity.id && observation.projectId === input.project.id && observation.schemaId === schema.id);
    for (const definition of type.fields) {
      const candidates = eligible.filter(observation => observation.field === definition.id);
      const accepted = candidates.filter(observation => {
        const segment = segments.get(observation.evidence.segmentId);
        const version = versions.get(observation.evidence.sourceVersionId);
        const blocked = openFindings.some(finding => finding.severity === 'critical' && ['acquisition','extraction','identity_scope'].includes(finding.kind) && (finding.field === null || finding.field === observation.field) && (finding.entityId === entity.id || finding.evidence.some(evidence => evidence.segmentId === observation.evidence.segmentId)));
        return observation.status === 'supported' && observation.mode === 'explicit' && observation.entityType === entity.type && stableStringify(normalizeScope(observation.scope)) === scope && !!segment && !!version && latestBySource.get(version.sourceId) === version.id && validateEvidence(observation.evidence, segment) && validateFieldValue(definition, observation.value) && !blocked;
      });
      withheld += candidates.length - accepted.length;
      if (accepted.length === 0) {
        if (definition.required) warnings.push(`No current supported value: ${definition.label}`);
        if (candidates.some(observation => observation.status === 'supported' && observation.mode === 'explicit' && versions.has(observation.evidence.sourceVersionId))) warnings.push(`Previously recorded ${definition.label} is unresolved in current evidence; absence is not asserted.`);
        continue;
      }
      included.push(...accepted);
      const unique = new Map(accepted.map(observation => [stableStringify(observation.value),observation.value]));
      const values = [...unique.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([,value]) => value);
      const evidence = [...new Map(accepted.map(observation => [stableStringify(observation.evidence), observation.evidence])).values()];
      fields[definition.id] = { value: values.length === 1 ? (values[0] ?? null) : null, observationIds: accepted.map(observation => observation.id).sort(), evidence, conflict: values.length > 1, alternatives: values.length > 1 ? values : [], ...(definition.unit ? { unit: definition.unit } : {}) };
      if (values.length > 1) warnings.push(`Sources disagree on ${definition.label}; no value selected`);
    }
    if (Object.keys(fields).length === 0) continue;
    const sourceCount = new Set(Object.values(fields).flatMap(field => field.evidence.map(evidence => versions.get(evidence.sourceVersionId)?.sourceId))).size;
    records.push({ id: stableId('record',entity.id), entityId: entity.id, entityType: entity.type, label: entity.label, scope: entity.scope, fields, sourceCount, warnings });
  }
  const sourceVersionIds = [...new Set(included.map(observation => observation.evidence.sourceVersionId))].sort();
  const sourceIds = new Set(sourceVersionIds.map(id => versions.get(id)?.sourceId));
  const families: Record<string,number> = {};
  for (const sourceId of sourceIds) {
    const source = sourceId ? sources.get(sourceId) : undefined;
    if (!source) continue;
    families[source.family] = (families[source.family] ?? 0) + 1;
  }
  const staleSources = [...sources.values()].filter(source => source.status === 'failed' || source.status === 'blocked');
  const warnings = [...(staleSources.length ? [`${staleSources.length} sources could not be refreshed. Previously supported evidence may be stale; no disappearance is inferred.`] : []), ...(withheld ? [`${withheld} observations withheld: unsupported evidence, applicability, schema, historical source version or extraction mode.`] : []), ...(openFindings.length ? [`${openFindings.length} unresolved audit findings remain.`] : []), ...(input.project.mode === 'demo' ? ['Synthetic demonstration data. These records are not real-world assertions.'] : [])];
  const version = (input.previous?.version ?? 0) + 1;
  return PublicationSchema.parse({ id: stableId('publication',input.project.id,schema.id,version,records,sourceVersionIds), projectId: input.project.id, schemaId: schema.id, version, createdAt: input.now, records, sourceVersionIds, coverage: { sources: sourceIds.size, sourceFamilies: families, entities: records.length, supportedObservations: included.length, openFindings: openFindings.length, schemaGaps: openFindings.filter(finding => finding.kind === 'schema_gap').length, description: `Published ${records.length} entities from ${sourceIds.size} contributing sources. Coverage is bounded by the project’s answerability contract.` }, warnings, previousId: input.previous?.id ?? null });
}
