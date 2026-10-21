import { z } from 'zod';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(JsonValueSchema)]));
export const IdSchema = z.string().min(1).max(240);
export const IsoDateSchema = z.string().datetime({ offset: true });
export const ScopeSchema = z.record(z.string());
export type Scope = z.infer<typeof ScopeSchema>;
export const BudgetSchema = z.object({ maxUsd: z.number().nonnegative().default(5), maxSearchQueries: z.number().int().min(0).max(1000).default(12), maxSources: z.number().int().min(1).max(10000).default(40), maxIterations: z.number().int().min(1).max(20).default(2), maxOutputTokens: z.number().int().min(256).max(32000).default(4096) });
export type Budget = z.infer<typeof BudgetSchema>;
export const AnswerabilitySchema = z.object({ topic: z.string().min(3).max(2000), questions: z.array(z.string().min(3)).min(1).max(30), inclusion: z.array(z.string()), exclusion: z.array(z.string()), languages: z.array(z.string()).default(['en']), sourceFamilies: z.array(z.string()).default([]), scope: ScopeSchema.default({}) });
export type Answerability = z.infer<typeof AnswerabilitySchema>;
export const ProjectSchema = z.object({ id: IdSchema, name: z.string().min(1).max(160), description: z.string(), contract: AnswerabilitySchema, budget: BudgetSchema, mode: z.enum(['demo','live']), status: z.enum(['draft','exploring','review','ready','paused']), seedUrls: z.array(z.string().url()), currentSchemaId: IdSchema.nullable(), publishedReleaseId: IdSchema.nullable(), createdAt: IsoDateSchema, updatedAt: IsoDateSchema });
export type Project = z.infer<typeof ProjectSchema>;

export const FieldDefinitionSchema = z.object({ id: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/), label: z.string().min(1), type: z.enum(['text','number','boolean','date','list','reference','json']), description: z.string().min(1), required: z.boolean().default(false), unit: z.string().optional(), enum: z.array(z.string()).optional(), targetType: z.string().optional(), jsonSchema: z.record(JsonValueSchema).optional() });
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;
export const EntityTypeSchema = z.object({ id: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/), label: z.string(), description: z.string(), identityFields: z.array(z.string()).min(1), scopeFields: z.array(z.string()), fields: z.array(FieldDefinitionSchema).min(1) });
export type EntityType = z.infer<typeof EntityTypeSchema>;
export const DomainSchemaSchema = z.object({ id: IdSchema, projectId: IdSchema, version: z.number().int().positive(), name: z.string(), description: z.string(), entityTypes: z.array(EntityTypeSchema).min(1), previousId: IdSchema.nullable(), createdAt: IsoDateSchema, rationale: z.string() });
export type DomainSchema = z.infer<typeof DomainSchemaSchema>;

export const SourceSchema = z.object({ id: IdSchema, projectId: IdSchema, url: z.string().url(), title: z.string(), family: z.string(), discoveredBy: z.string(), relevance: z.string(), status: z.enum(['pending','fetched','unchanged','blocked','failed']), latestVersionId: IdSchema.nullable(), etag: z.string().nullable(), lastModified: z.string().nullable(), lastCheckedAt: IsoDateSchema.nullable(), error: z.string().nullable(), createdAt: IsoDateSchema });
export type Source = z.infer<typeof SourceSchema>;
export const SourceVersionSchema = z.object({ id: IdSchema, projectId: IdSchema, sourceId: IdSchema, url: z.string().url(), fetchedAt: IsoDateSchema, contentHash: z.string().regex(/^[a-f0-9]{64}$/), blobKey: z.string(), mediaType: z.string(), byteLength: z.number().int().nonnegative(), acquisition: z.enum(['http','exa-contents','fixture','import']), headers: z.record(z.string()), parserVersion: z.string(), textHash: z.string(), title: z.string(), warnings: z.array(z.string()) });
export type SourceVersion = z.infer<typeof SourceVersionSchema>;
export const SegmentSchema = z.object({ id: IdSchema, projectId: IdSchema, sourceVersionId: IdSchema, index: z.number().int().nonnegative(), text: z.string(), heading: z.string(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), page: z.number().int().positive().optional(), context: z.string(), parserVersion: z.string(), quality: z.enum(['ok','warning','blocked']), warnings: z.array(z.string()) });
export type Segment = z.infer<typeof SegmentSchema>;
export const EvidenceSchema = z.object({ sourceVersionId: IdSchema, segmentId: IdSchema, start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), quote: z.string().min(1), page: z.number().int().positive().optional() });
export type Evidence = z.infer<typeof EvidenceSchema>;
export const EntitySchema = z.object({ id: IdSchema, projectId: IdSchema, type: z.string(), label: z.string(), identity: ScopeSchema, scope: ScopeSchema, createdAt: IsoDateSchema });
export type Entity = z.infer<typeof EntitySchema>;
export const ObservationSchema = z.object({ id: IdSchema, projectId: IdSchema, entityId: IdSchema, entityType: z.string(), field: z.string(), value: JsonValueSchema, scope: ScopeSchema, evidence: EvidenceSchema, schemaId: IdSchema, runId: IdSchema, extractionSpecHash: z.string(), model: z.string(), mode: z.enum(['explicit','derived','estimated']), confidence: z.number().min(0).max(1).nullable(), status: z.enum(['supported','unverified','rejected']), validFrom: z.string().nullable(), validTo: z.string().nullable(), observedAt: IsoDateSchema });
export type Observation = z.infer<typeof ObservationSchema>;
export const FindingKindSchema = z.enum(['acquisition','extraction','schema_gap','identity_scope','disagreement']);
export type FindingKind = z.infer<typeof FindingKindSchema>;
export const FindingSchema = z.object({ id: IdSchema, projectId: IdSchema, runId: IdSchema, kind: FindingKindSchema, severity: z.enum(['info','warning','critical']), title: z.string(), description: z.string(), action: z.string(), evidence: z.array(EvidenceSchema), entityId: IdSchema.nullable(), field: z.string().nullable(), status: z.enum(['open','resolved','dismissed']), resolution: z.string().nullable(), createdAt: IsoDateSchema });
export type Finding = z.infer<typeof FindingSchema>;
export const ProposalSchema = z.object({ id: IdSchema, projectId: IdSchema, baseSchemaId: IdSchema, candidate: DomainSchemaSchema, findingIds: z.array(IdSchema), rationale: z.string(), breaking: z.boolean(), changes: z.array(z.string()), affectedSourceVersionIds: z.array(IdSchema), status: z.enum(['pending','approved','rejected','stale']), decision: z.string().nullable(), decidedAt: IsoDateSchema.nullable(), createdAt: IsoDateSchema });
export type Proposal = z.infer<typeof ProposalSchema>;

export const UsageSchema = z.object({ id: IdSchema, projectId: IdSchema, runId: IdSchema, provider: z.string(), model: z.string(), operation: z.string(), inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(), estimatedCostUsd: z.number().nonnegative(), reportedCostUsd: z.number().nonnegative().nullable(), createdAt: IsoDateSchema });
export type Usage = z.infer<typeof UsageSchema>;
export const RunSchema = z.object({ id: IdSchema, projectId: IdSchema, kind: z.enum(['cycle','ingest','replay','maintenance','publish']), status: z.enum(['queued','running','completed','failed','budget_exhausted','cancelled']), phase: z.string(), startedAt: IsoDateSchema, completedAt: IsoDateSchema.nullable(), stats: z.object({ queries: z.number(), sources: z.number(), observations: z.number(), findings: z.number(), estimatedCostUsd: z.number() }), error: z.string().nullable() });
export type Run = z.infer<typeof RunSchema>;
export const EventSchema = z.object({ id: IdSchema, projectId: IdSchema, runId: IdSchema, phase: z.string(), message: z.string(), level: z.enum(['info','warning','error']), data: z.record(JsonValueSchema), createdAt: IsoDateSchema });
export type EngineEvent = z.infer<typeof EventSchema>;
export const JobSchema = z.object({ id: IdSchema, projectId: IdSchema, kind: z.enum(['cycle','ingest','replay','maintenance','publish']), key: z.string(), payload: z.record(JsonValueSchema), status: z.enum(['queued','running','succeeded','failed','cancelled']), attempt: z.number().int(), maxAttempts: z.number().int(), availableAt: IsoDateSchema, leaseOwner: z.string().nullable(), leaseToken: z.string().nullable(), leaseExpiresAt: IsoDateSchema.nullable(), lastError: z.string().nullable(), createdAt: IsoDateSchema, updatedAt: IsoDateSchema });
export type Job = z.infer<typeof JobSchema>;
export const PublishedFieldSchema = z.object({ value: JsonValueSchema, observationIds: z.array(IdSchema), evidence: z.array(EvidenceSchema), conflict: z.boolean(), alternatives: z.array(JsonValueSchema), unit: z.string().optional() });
export type PublishedField = z.infer<typeof PublishedFieldSchema>;
export const PublishedRecordSchema = z.object({ id: IdSchema, entityId: IdSchema, entityType: z.string(), label: z.string(), scope: ScopeSchema, fields: z.record(PublishedFieldSchema), sourceCount: z.number().int(), warnings: z.array(z.string()) });
export type PublishedRecord = z.infer<typeof PublishedRecordSchema>;
export const CoverageSchema = z.object({ sources: z.number(), sourceFamilies: z.record(z.number()), entities: z.number(), supportedObservations: z.number(), openFindings: z.number(), schemaGaps: z.number(), description: z.string() });
export type Coverage = z.infer<typeof CoverageSchema>;
export const PublicationSchema = z.object({ id: IdSchema, projectId: IdSchema, schemaId: IdSchema, version: z.number().int().positive(), createdAt: IsoDateSchema, records: z.array(PublishedRecordSchema), sourceVersionIds: z.array(IdSchema), coverage: CoverageSchema, warnings: z.array(z.string()), previousId: IdSchema.nullable() });
export type Publication = z.infer<typeof PublicationSchema>;

export const CollectionSchemas = { projects: ProjectSchema, schemas: DomainSchemaSchema, sources: SourceSchema, sourceVersions: SourceVersionSchema, segments: SegmentSchema, entities: EntitySchema, observations: ObservationSchema, findings: FindingSchema, proposals: ProposalSchema, runs: RunSchema, events: EventSchema, publications: PublicationSchema, usage: UsageSchema };
export type Collection = keyof typeof CollectionSchemas;
export type RecordsByCollection = { [K in Collection]: z.infer<(typeof CollectionSchemas)[K]> };
export const IMMUTABLE_COLLECTIONS: ReadonlySet<Collection> = new Set(['schemas','sourceVersions','segments','observations','publications','usage','events']);
export const WorkspaceSnapshotSchema = z.object({ version: z.literal(1), generatedAt: IsoDateSchema, mode: z.enum(['demo','live']), projects: z.array(ProjectSchema), schemas: z.array(DomainSchemaSchema), sources: z.array(SourceSchema), sourceVersions: z.array(SourceVersionSchema), segments: z.array(SegmentSchema), entities: z.array(EntitySchema), observations: z.array(ObservationSchema), findings: z.array(FindingSchema), proposals: z.array(ProposalSchema), runs: z.array(RunSchema), events: z.array(EventSchema), jobs: z.array(JobSchema), publications: z.array(PublicationSchema), usage: z.array(UsageSchema) });
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;

/** Public site input: no operator runs, credentials, raw documents or unpublished claims. */
export const PublicDatasetSchema = z.object({
  project: ProjectSchema.pick({ id: true, name: true, description: true, mode: true }),
  publication: PublicationSchema,
  schema: DomainSchemaSchema,
  sources: z.array(SourceVersionSchema.pick({ id: true, url: true, title: true, fetchedAt: true, acquisition: true })),
});
export type PublicDataset = z.infer<typeof PublicDatasetSchema>;
export const CatalogDataSchema = z.object({ datasets: z.array(PublicDatasetSchema) });
export type CatalogData = z.infer<typeof CatalogDataSchema>;

export interface Clock { now(): string }
export const systemClock: Clock = { now: () => new Date().toISOString() };
export interface ModelUsage { provider: string; model: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number; reportedCostUsd: number | null }
export interface ModelResult<T> { data: T; usage: ModelUsage }
export interface SearchQuery { query: string; objective: string; family: string; exploratory: boolean }
export interface SearchHit { url: string; title: string; family: string; publishedAt?: string }
export interface SearchProvider { name: string; search(query: SearchQuery, limit: number): Promise<ModelResult<SearchHit[]>> }
export interface ReasoningRequest { role: 'planner' | 'architect' | 'auditor' | 'resolver'; task: string; system: string; input: JsonValue; maxOutputTokens: number }
export interface Reasoner { name: string; complete<T>(request: ReasoningRequest, schema: z.ZodType<T>): Promise<ModelResult<T>> }
export interface ExtractedValue { value: JsonValue; confidence: number | null; quote: string | null; start: number | null; end: number | null; warnings: string[] }
export interface ExtractionRequest { entityType: EntityType; segment: Segment; schemaId: string; sourceVersionId: string; referenceDate: string }
export interface ExtractionResult { values: Record<string, ExtractedValue>; usage: ModelUsage; truncated: boolean }
export interface Extractor { name: string; extract(request: ExtractionRequest): Promise<ExtractionResult> }
export interface AcquiredDocument { url: string; status: number; bytes: Uint8Array; mediaType: string; headers: Record<string,string>; acquiredAt: string; acquisition: SourceVersion['acquisition']; notModified: boolean }
export interface FetchOptions { etag?: string; lastModified?: string; maxBytes?: number; timeoutMs?: number }
export interface Acquirer { fetch(url: string, options?: FetchOptions): Promise<AcquiredDocument> }
export interface ParsedDocument { title: string; text: string; parserVersion: string; segments: Array<Omit<Segment,'id'|'projectId'|'sourceVersionId'>>; warnings: string[]; links: string[] }
export interface Parser { parse(document: AcquiredDocument): Promise<ParsedDocument> }

// Deterministic implementation exports (owned by core; signature changes require PM).
export interface SchemaChange { breaking: boolean; changes: string[] }
export interface ProjectionInput { project: Project; schema: DomainSchema; entities: Entity[]; observations: Observation[]; segments: Segment[]; sources: Source[]; sourceVersions: SourceVersion[]; findings: Finding[]; previous: Publication | null; now: string }
