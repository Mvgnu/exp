import type { Acquirer, Clock, DomainSchema, Extractor, Job, Parser, Project, Proposal, Publication, Reasoner, Run, SearchProvider, WorkspaceSnapshot } from '@deeplake/core';
import type { BlobStore, Repository } from '@deeplake/store';
export interface EngineDependencies { repository: Repository; blobs: BlobStore; search: SearchProvider; reasoner: Reasoner; extractor: Extractor; acquirer: Acquirer; parser: Parser; clock?: Clock }
export interface CycleOptions { sourceUrls?: string[]; skipSearch?: boolean; sourceVersionIds?: string[] }
export interface Engine {
  runCycle(projectId: string, options?: CycleOptions): Promise<Run>;
  ingest(projectId: string, urls: string[]): Promise<Run>;
  maintain(projectId: string): Promise<Run>;
  replay(projectId: string, sourceVersionIds?: string[]): Promise<Run>;
  approveProposal(proposalId: string, decision: string, allowBreaking?: boolean): Promise<Proposal>;
  rejectProposal(proposalId: string, decision: string): Promise<Proposal>;
  publish(projectId: string): Promise<Publication>;
  rollback(projectId: string, publicationId: string): Promise<Project>;
  executeJob(job: Job): Promise<void>;
}
export interface CreateProjectInput { name: string; description?: string; topic: string; questions: string[]; inclusion?: string[]; exclusion?: string[]; sourceFamilies?: string[]; seedUrls?: string[]; mode?: 'demo'|'live'; budget?: Partial<Project['budget']>; scope?: Record<string,string> }
export type { Project, DomainSchema, WorkspaceSnapshot };
