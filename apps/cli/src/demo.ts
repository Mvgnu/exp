import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createEngine, createProject } from '@deeplake/engine';
import { createParser } from '@deeplake/ingest';
import { WorkspaceSnapshotSchema, CatalogDataSchema } from '@deeplake/core';
import type { WorkspaceSnapshot } from '@deeplake/core';
import type { BlobStore, Repository } from '@deeplake/store';
import { createDemoProviders, demoClock, repositoryRoot } from './demo-providers.js';

export async function seedDemo(repository:Repository,blobs:BlobStore):Promise<WorkspaceSnapshot> {
  const existing=await repository.list('projects');
  if(existing.length){if(existing.some(p=>p.mode!=='demo'))throw new Error('Refusing to seed demonstration data into a database containing live projects.');return WorkspaceSnapshotSchema.parse(await repository.snapshot('demo'));}
  const clock=demoClock(),providers=await createDemoProviders(clock),engine=createEngine({repository,blobs,clock,parser:createParser(),...providers});
  const curriculum={...createProject({name:'Computer science curricula',description:'Compare modules, assessment formats and version-specific requirements. Synthetic source fixtures.',topic:'Computer science curricula and module handbooks',questions:['Which modules award at least 6 ECTS?','Which prerequisites are alternatives and which are merely recommended?','How do module requirements differ between curriculum versions?'],sourceFamilies:['module-handbook','assessment-regulations'],mode:'demo',budget:{maxUsd:5,maxSources:40,maxIterations:2,maxSearchQueries:6}},clock),id:'project_curricula'};
  const procurement={...createProject({name:'Municipal procurement',description:'Track notice conditions, estimated values and source disagreements. Synthetic notices.',topic:'Municipal procurement notices and award registers',questions:['Which IT services contracts have open submission deadlines?','What extension options do framework notices contain?','Do different sources agree on the stated estimated value?'],sourceFamilies:['procurement-notice','award-register'],mode:'demo',budget:{maxUsd:5,maxSources:30,maxIterations:2,maxSearchQueries:6}},clock),id:'project_procurement'};
  await repository.put('projects',curriculum,{insertOnly:true});
  const initial=await engine.runCycle(curriculum.id);if(initial.status==='failed')throw new Error(initial.error??'Curriculum bootstrap failed');
  await engine.publish(curriculum.id);
  const proposal=(await repository.list('proposals',{projectId:curriculum.id})).find(p=>p.status==='pending');
  if(!proposal)throw new Error('Demo must discover the prerequisite representation gap; no proposal was produced.');
  await engine.approveProposal(proposal.id,'Accept the evidence-backed prerequisite rule and replay affected sources.');
  for(let i=0;i<20;i++){const job=await repository.claim('demo-worker',60000);if(!job)break;if(!job.leaseToken)throw new Error('Demo job lease missing');try{await engine.executeJob(job);if(!await repository.complete(job.id,job.leaseToken))throw new Error('Demo lease lost');}catch(error){await repository.fail(job.id,job.leaseToken,error instanceof Error?error.message:'Demo worker failure',0);throw error;}}
  await engine.publish(curriculum.id);
  await engine.maintain(curriculum.id);
  await repository.put('projects',procurement,{insertOnly:true});
  const second=await engine.runCycle(procurement.id);if(second.status==='failed')throw new Error(second.error??'Procurement bootstrap failed');
  await engine.publish(procurement.id);
  const snapshot=WorkspaceSnapshotSchema.parse(await repository.snapshot('demo'));
  const published=snapshot.publications.flatMap(p=>p.records);
  if(!published.length)throw new Error('Demo produced no published records.');
  if(!snapshot.proposals.some(p=>p.status==='approved')||!snapshot.proposals.some(p=>p.status==='pending'))throw new Error('Demo must contain completed and pending schema evolution.');
  return snapshot;
}
export async function exportDemo(snapshot:WorkspaceSnapshot):Promise<void> {
  if(snapshot.mode!=='demo'||snapshot.projects.some(p=>p.mode!=='demo'))throw new Error('Static demo export refuses live operator data. Use the public publication API for a real site.');
  const data=JSON.stringify(snapshot,null,2)+'\n';
  const path=resolve(repositoryRoot,'sites/workbench/data');await mkdir(path,{recursive:true});await writeFile(resolve(path,'snapshot.json'),data);
  const datasets=snapshot.projects.map(project=>{const publication=snapshot.publications.find(p=>p.id===project.publishedReleaseId);if(!publication)throw new Error('Missing demo publication');const schema=snapshot.schemas.find(s=>s.id===publication.schemaId);if(!schema)throw new Error('Missing demo schema');return {project:{id:project.id,name:project.name,description:project.description,mode:project.mode},publication,schema,sources:snapshot.sourceVersions.filter(v=>publication.sourceVersionIds.includes(v.id)).map(({id,url,title,fetchedAt,acquisition})=>({id,url,title,fetchedAt,acquisition}))};});
  const catalogPath=resolve(repositoryRoot,'sites/catalog/data');await mkdir(catalogPath,{recursive:true});await writeFile(resolve(catalogPath,'catalog.json'),JSON.stringify(CatalogDataSchema.parse({datasets}),null,2)+'\n');
}
