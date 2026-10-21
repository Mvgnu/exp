import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
import { JsonValueSchema, SegmentSchema, EntityTypeSchema, hash } from '@deeplake/core';
import type { AcquiredDocument, Acquirer, Clock, EntityType, Evidence, ExtractedValue, ExtractionRequest, Extractor, FieldDefinition, JsonValue, ModelResult, ModelUsage, Reasoner, ReasoningRequest, SearchProvider, Segment } from '@deeplake/core';

export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const FixtureSchema=z.object({url:z.string().url(),path:z.string(),family:z.string(),title:z.string(),fields:z.record(JsonValueSchema)});
export type Fixture=z.infer<typeof FixtureSchema>;
export async function loadFixtures():Promise<Fixture[]> { return z.array(FixtureSchema).parse(JSON.parse(await readFile(resolve(repositoryRoot,'fixtures/manifest.json'),'utf8'))); }
const zeroUsage=(model:string):ModelUsage=>({provider:'demo',model,inputTokens:0,outputTokens:0,estimatedCostUsd:0,reportedCostUsd:0});
export function demoClock():Clock { let tick=0; return {now:()=>new Date(Date.UTC(2026,9,21,9,0,tick++)).toISOString()}; }
function record(value:JsonValue|undefined):Record<string,JsonValue> { return value!==null && typeof value==='object' && !Array.isArray(value) ? value : {}; }
function collectSegments(value:JsonValue):Segment[] {
  const result:Segment[]=[];
  function visit(item:JsonValue):void { const parsed=SegmentSchema.safeParse(item); if(parsed.success){result.push(parsed.data);return;} if(Array.isArray(item))item.forEach(visit);else if(item!==null&&typeof item==='object')Object.values(item).forEach(visit); }
  visit(value); return [...new Map(result.map(s=>[s.id,s])).values()];
}
function field(id:string,label:string,type:FieldDefinition['type'],description:string,required=false):FieldDefinition {return {id,label,type,description,required};}
export function demoEntityType(procurement:boolean,expanded=false):EntityType {
  if(procurement)return {id:'notice',label:'Procurement notice',description:'A synthetic public procurement notice scoped to its reporting year.',identityFields:['reference','authority'],scopeFields:['year'],fields:[field('reference','Notice reference','text','Explicit identifier of this notice.',true),field('name','Title','text','Explicit procurement title.',true),field('authority','Authority','text','Contracting authority.',true),field('year','Year','text','Reporting year.',true),{...field('estimatedValue','Estimated value','number','Value explicitly stated in the notice; not a calculated estimate.'),unit:'EUR'},field('deadline','Deadline','date','Stated submission deadline.'),field('category','Category','text','Service classification.'),field('region','Region','text','Region named in this fixture.'),...(expanded?[{...field('renewalOption','Renewal option','json','Stated renewal term and maximum total term.'),jsonSchema:{type:'object',properties:{years:{type:'number'},maximumTotalYears:{type:'number'}},required:['years','maximumTotalYears'],additionalProperties:false}}]:[])]};
  return {id:'module',label:'Study module',description:'One module under a specific institution and curriculum.',identityFields:['code','institution'],scopeFields:['curriculum'],fields:[field('code','Module code','text','Stated module identifier.',true),field('name','Module name','text','Module title.',true),field('institution','Institution','text','Institution responsible for this module.',true),field('curriculum','Curriculum','text','Curriculum version, never inferred from the retrieval date.',true),{...field('credits','Credits','number','Explicit credits for this module.'),unit:'ECTS'},field('assessment','Assessment','text','Stated examination format.'),field('category','Category','text','Core or elective status.'),field('term','Term','text','Teaching term.'),...(expanded?[{...field('prerequisiteRule','Prerequisite rule','json','Distinguish any-of, all-of eligibility conditions and recommendations.'),jsonSchema:{type:'object',properties:{anyOf:{type:'array',items:{type:'string'}},allOf:{type:'array',items:{type:'string'}},recommended:{type:'array',items:{type:'string'}}},additionalProperties:false}}]:[])]};
}
function parseField(segment:Segment,definition:FieldDefinition):ExtractedValue {
  const escaped=definition.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=new RegExp(`(?:^|\\n)${escaped}:\\s*([^\\n]+)`,'i').exec(segment.text);
  if(!match||!match[1])return {value:null,confidence:null,quote:null,start:null,end:null,warnings:[]};
  const raw=match[1].trim(); let value:JsonValue=raw;
  try { if(definition.type==='number')value=Number(raw);else if(definition.type==='boolean')value=raw.toLowerCase()==='true';else if(definition.type==='json'||definition.type==='list')value=JsonValueSchema.parse(JSON.parse(raw)); } catch { return {value:null,confidence:null,quote:raw,start:segment.text.indexOf(raw,match.index),end:segment.text.indexOf(raw,match.index)+raw.length,warnings:['Fixture value does not match requested type.']}; }
  if(typeof value==='number'&&!Number.isFinite(value))value=null;
  const start=segment.text.indexOf(raw,match.index);return {value,confidence:value===null?null:1,quote:raw,start,end:start+raw.length,warnings:[]};
}
function evidenceFor(segment:Segment,label:string):Evidence|null { const start=segment.text.indexOf(label);if(start<0)return null;const end=segment.text.indexOf('\n',start);return {sourceVersionId:segment.sourceVersionId,segmentId:segment.id,start,end:end<0?segment.text.length:end,quote:segment.text.slice(start,end<0?segment.text.length:end),...(segment.page?{page:segment.page}:{})}; }
export async function createDemoProviders(clock:Clock=demoClock()) {
  const fixtures=await loadFixtures();
  const documents=new Map(await Promise.all(fixtures.map(async f=>[f.url,await readFile(resolve(repositoryRoot,f.path),'utf8')] as const)));
  const acquirer:Acquirer={async fetch(url,options){const body=documents.get(url);if(body===undefined)throw new Error(`Demo fixture not found: ${url}. Demo mode never fetches the network.`);const etag=hash(body);const notModified=options?.etag===etag;return {url,status:notModified?304:200,bytes:new TextEncoder().encode(notModified?'':body),mediaType:'text/markdown',headers:{etag,'last-modified':'Wed, 21 Oct 2026 09:00:00 GMT'},acquiredAt:clock.now(),acquisition:'fixture',notModified};}};
  const search:SearchProvider={name:'demo/source-manifest',async search(query,limit){const procurement=/procurement|tender|award/i.test(query.query);let selected=fixtures.filter(f=>f.url.includes(procurement?'procurement':'curricula'));const byFamily=selected.filter(f=>f.family===query.family);if(byFamily.length)selected=byFamily;return {data:selected.slice(0,limit).map(f=>({url:f.url,title:f.title,family:f.family})),usage:zeroUsage('source-manifest')};}};
  const extractor:Extractor={name:'demo/explicit-lines-v1',async extract(request){const values:Record<string,ExtractedValue>={};for(const f of request.entityType.fields){values[f.id]=f.type==='json'?{value:null,confidence:null,quote:null,start:null,end:null,warnings:['Structured field requires explicit resolver.']}:parseField(request.segment,f);}return {values,usage:zeroUsage('explicit-lines-v1'),truncated:false};}};
  const reasoner:Reasoner={name:'demo/fixture-reasoner-v1',async complete<T>(request:ReasoningRequest,schema:z.ZodType<T>):Promise<ModelResult<T>>{
    const input=record(request.input),project=record(input.project),contract=record(project.contract);
    const procurement=/procurement|tender/i.test(String(contract.topic??JSON.stringify(project)));
    const segments=collectSegments(request.input);
    const existing=record(input.schema);
    const existingTypes=z.array(EntityTypeSchema).safeParse(existing.entityTypes);
    const expanded=existingTypes.success&&existingTypes.data.some(t=>t.fields.some(f=>f.id==='prerequisiteRule'||f.id==='renewalOption'));
    const draft=(expand:boolean)=>({name:procurement?'Municipal procurement':'Computer science curricula',description:'Synthetic demonstration schema. Field values are supported by checked-in fixtures.',entityTypes:[demoEntityType(procurement,expand)],rationale:expand?'Represent conditional terms that the source states and the prior schema could not express.':'Represent the bounded questions and preserve institution/year scope.'});
    let output:unknown;
    switch(request.task){
      case 'plan-queries':output={queries:procurement?[{query:'procurement notices framework tenders',objective:'Find primary notice records',family:'procurement-notice',exploratory:false},{query:'procurement award registers corrections',objective:'Explore alternate reports and disagreements',family:'award-register',exploratory:true}]:[{query:'computer science curricula module handbooks',objective:'Discover module and curriculum records',family:'module-handbook',exploratory:false},{query:'curricula assessment regulations module requirements',objective:'Explore alternate source families and exceptions',family:'assessment-regulations',exploratory:true}]};break;
      case 'bootstrap-schema':output=draft(false);break;
      case 'propose-schema':output=draft(true);break;
      case 'audit-representation': {
        const findings=[];if(!expanded){for(const segment of segments){const label=procurement?'Renewal option:':'Prerequisite rule:';const evidence=evidenceFor(segment,label);if(!evidence)continue;findings.push({kind:'schema_gap',severity:'warning',title:procurement?'Renewal terms are not represented':'Alternative prerequisites need a structured rule',description:procurement?'The source states an extension option and a maximum contract term. The active schema cannot retain either.':'The source distinguishes eligibility alternatives from recommended preparation. A flat prerequisite field would lose the logical relationship.',action:'Review an additive schema proposal, then replay the affected source evidence.',evidence:[evidence],entityId:null,field:procurement?'renewalOption':'prerequisiteRule'});}}
        output={findings};break;}
      case 'audit-extraction':output={findings:[]};break;
      case 'extract-structured': {
        const segment=segments[0];const type=EntityTypeSchema.safeParse(input.entityType);const definitions=type.success?type.data.fields:demoEntityType(procurement,true).fields;const values:Record<string,ExtractedValue>={};if(segment)for(const definition of definitions.filter(f=>f.type==='json'))values[definition.id]=parseField(segment,definition);output={values};break;}
      default:throw new Error(`Demo reasoner does not implement task: ${request.task}`);
    }
    return {data:schema.parse(output),usage:zeroUsage(`fixture-reasoner/${request.task}`)};
  }};
  return {acquirer,search,extractor,reasoner,fixtures,replaceDocument:(url:string,text:string)=>{if(!documents.has(url))throw new Error('Unknown fixture URL');documents.set(url,text);},documents};
}
