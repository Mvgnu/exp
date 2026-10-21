import { randomUUID } from 'node:crypto';
import { BudgetSchema, ProjectSchema, systemClock } from '@deeplake/core';
import type { Clock, Project } from '@deeplake/core';
import type { CreateProjectInput } from './contract.js';

export function createProject(input: CreateProjectInput, clock: Clock = systemClock): Project {
  const now = clock.now();
  return ProjectSchema.parse({
    id: `project_${randomUUID()}`, name: input.name, description: input.description ?? '',
    contract: { topic: input.topic, questions: input.questions, inclusion: input.inclusion ?? [], exclusion: input.exclusion ?? [], languages: ['en'], sourceFamilies: input.sourceFamilies ?? [], scope: input.scope ?? {} },
    budget: BudgetSchema.parse(input.budget ?? {}), mode: input.mode ?? 'live', status: 'draft',
    seedUrls: input.seedUrls ?? [], currentSchemaId: null, publishedReleaseId: null, createdAt: now, updatedAt: now,
  });
}
