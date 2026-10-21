import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore, FileBlobStore } from '@deeplake/store';
import { createProject } from '@deeplake/engine';
import { configuration, createRuntime, loadEnvironment } from './runtime.js';
import { exportDemo, seedDemo } from './demo.js';
import { repositoryRoot } from './demo-providers.js';
const {positionals,values}=parseArgs({allowPositionals:true,options:{persist:{type:'boolean'},topic:{type:'string'},name:{type:'string'},question:{type:'string',multiple:true},url:{type:'string',multiple:true},reason:{type:'string'},'allow-breaking':{type:'boolean'},out:{type:'string'},'skip-search':{type:'boolean'},'max-usd':{type:'string'}}});
const [command,id,extra]=positionals;
loadEnvironment();
async function main(){
  if(command==='init'){const path=resolve(repositoryRoot,'.env');if(existsSync(path))throw new Error('.env already exists; initialization never overwrites credentials.');const template=await readFile(resolve(repositoryRoot,'.env.example'),'utf8');await writeFile(path,template.replace('replace-with-a-random-token-at-least-24-characters',randomBytes(32).toString('hex')),{mode:0o600,flag:'wx'});console.log('Created .env with a random operator token. Copy DEEPLAKE_API_TOKEN into the workbench connection dialog.');return;}
  if(command==='demo'&&!values.persist){const repository=await createStore({memory:true});const blobs=new FileBlobStore(resolve(tmpdir(),'deeplake-demo-blobs'));try{const snapshot=await seedDemo(repository,blobs);await exportDemo(snapshot);console.log(JSON.stringify({mode:'demo',projects:snapshot.projects.length,sources:snapshot.sources.length,observations:snapshot.observations.length,proposals:snapshot.proposals.map(p=>({status:p.status,changes:p.changes})),publications:snapshot.publications.length},null,2));}finally{await repository.close();}return;}
  if(!command||command==='help'){console.log(`Deeplake — universal evidence engine\n\n  pnpm cli init\n  pnpm demo                         Generate the synthetic, runnable two-domain demo\n  pnpm cli demo --persist            Seed the local database as well\n  pnpm cli create --name NAME --topic TOPIC --question QUESTION [--url URL]\n  pnpm cli run PROJECT_ID [--skip-search]\n  pnpm cli maintain PROJECT_ID\n  pnpm cli replay PROJECT_ID\n  pnpm cli approve PROPOSAL_ID --reason TEXT [--allow-breaking]\n  pnpm cli reject PROPOSAL_ID --reason TEXT\n  pnpm cli publish PROJECT_ID\n  pnpm cli rollback PROJECT_ID PUBLICATION_ID\n  pnpm cli inspect [PROJECT_ID]\n  pnpm cli export PROJECT_ID --out publication.json\n\nLive operations use configured paid APIs and the project's budget. No silent demo fallback.\nStop the local API before opening its PGlite directory from the CLI; production uses PostgreSQL.`);return;}
  const runtime=await createRuntime(configuration());
  try{
    if(command==='demo'){const snapshot=await seedDemo(runtime.repository,runtime.blobs);await exportDemo(snapshot);console.log(`Seeded ${snapshot.projects.length} demonstration projects.`);return;}
    if(command==='create'){if(!values.name||!values.topic||!values.question?.length)throw new Error('create requires --name, --topic and at least one --question');const project=createProject({name:values.name,topic:values.topic,questions:values.question,seedUrls:values.url??[],mode:'live',budget:values['max-usd']?{maxUsd:Number(values['max-usd'])}:undefined});await runtime.repository.put('projects',project,{insertOnly:true});console.log(JSON.stringify(project,null,2));return;}
    if(command==='inspect'){const snapshot=await runtime.repository.snapshot();console.log(JSON.stringify({projects:snapshot.projects.filter(p=>!id||p.id===id),runs:snapshot.runs.filter(r=>!id||r.projectId===id),findings:snapshot.findings.filter(f=>(!id||f.projectId===id)&&f.status==='open'),proposals:snapshot.proposals.filter(p=>(!id||p.projectId===id)&&p.status==='pending'),jobs:snapshot.jobs.filter(j=>!id||j.projectId===id)},null,2));return;}
    if(!id)throw new Error(`${command} requires an identifier`);
    if(command==='approve'||command==='reject'){if(!values.reason)throw new Error('A --reason is required');const proposal=await runtime.repository.get('proposals',id);if(!proposal)throw new Error('Proposal not found');const engine=await runtime.getEngine(proposal.projectId);console.log(JSON.stringify(command==='approve'?await engine.approveProposal(id,values.reason,values['allow-breaking']):await engine.rejectProposal(id,values.reason),null,2));return;}
    if(command==='export'){const project=await runtime.repository.get('projects',id);if(!project?.publishedReleaseId)throw new Error('Project has no published release');const publication=await runtime.repository.get('publications',project.publishedReleaseId);if(!publication)throw new Error('Release not found');const schema=await runtime.repository.get('schemas',publication.schemaId);const sources=(await runtime.repository.list('sourceVersions',{projectId:id})).filter(v=>publication.sourceVersionIds.includes(v.id)).map(({id,url,title,fetchedAt,acquisition})=>({id,url,title,fetchedAt,acquisition}));const output=resolve(values.out??'publication.json');await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify({project:{id:project.id,name:project.name,description:project.description,mode:project.mode},publication,schema,sources},null,2)+'\n');console.log(`Exported published release to ${output}`);return;}
    const engine=await runtime.getEngine(id);let result:unknown;
    if(command==='run')result=await engine.runCycle(id,{skipSearch:values['skip-search']});else if(command==='maintain')result=await engine.maintain(id);else if(command==='replay')result=await engine.replay(id);else if(command==='publish')result=await engine.publish(id);else if(command==='rollback'&&extra)result=await engine.rollback(id,extra);else throw new Error(`Unknown command: ${command}. Run pnpm cli help.`);
    console.log(JSON.stringify(result,null,2));
  }finally{await runtime.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Command failed');process.exitCode=1;});
