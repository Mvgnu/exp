import { describe, expect, it } from 'vitest';
import { buildPublication, diffSchemas, entityId, hash, stableId, stableStringify, validateDomainSchema, validateEvidence, validateFieldValue } from '../src/index.js';
import { entity, now, observation, projection, schema, segment, source, version } from './fixtures.js';

describe('canonical evidence identities', () => {
  it('canonicalizes object keys, preserves array ordering, rejects lossy input and cycles', () => {
    expect(stableStringify({b:[1,2],a:'x'})).toBe(stableStringify({a:'x',b:[1,2]}));
    expect(stableId('x',[1,2])).not.toBe(stableId('x',[2,1]));
    for (const invalid of [NaN,Infinity,undefined,BigInt(1),new Date()]) expect(() => stableStringify(invalid)).toThrow();
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    expect(() => stableStringify(cyclic)).toThrow(/cycles/);
    expect(hash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('binds identity to project, type and scope without folding case', () => {
    expect(entityId('p','record',{code:'A'},{edition:'2026'})).not.toBe(entityId('p','record',{code:'A'},{edition:'2025'}));
    expect(entityId('p','record',{code:'A'},{edition:'2026'})).not.toBe(entityId('q','record',{code:'A'},{edition:'2026'}));
    expect(entityId('p','record',{code:'A'},{})).not.toBe(entityId('p','record',{code:'a'},{}));
    expect(() => entityId('p','record',{code:''},{})).toThrow();
  });
});

describe('schema semantics and compatibility', () => {
  it('rejects dangling fields, duplicate definitions and unusable references', () => {
    const type = schema.entityTypes[0]!;
    expect(() => validateDomainSchema({...schema,entityTypes:[type,type]})).toThrow(/Duplicate/);
    expect(() => validateDomainSchema({...schema,entityTypes:[{...type,identityFields:['absent']}]})).toThrow(/Unknown/);
    expect(() => validateDomainSchema({...schema,entityTypes:[{...type,fields:[...type.fields,{id:'parent',label:'Parent',description:'Related item',type:'reference',required:false,targetType:'missing'}]}]})).toThrow(/reference target/);
  });
  it('detects breaking scope/unit/requiredness and permits optional additive changes', () => {
    const type = schema.entityTypes[0]!;
    const add = {...schema,id:'s2',version:2,previousId:'s1',entityTypes:[{...type,fields:[...type.fields,{id:'note',label:'Note',description:'Explicit note',type:'text' as const,required:false}]}]};
    expect(diffSchemas(schema,add).breaking).toBe(false);
    expect(diffSchemas(schema,{...add,entityTypes:[{...type,scopeFields:[]}]}).breaking).toBe(true);
    expect(diffSchemas(schema,{...add,entityTypes:[{...type,fields:type.fields.map(f => f.id === 'amount' ? {...f,unit:'other'} : f)}]}).breaking).toBe(true);
  });
  it('validates structured values and rejects impossible dates and null facts', () => {
    const field = {id:'conditions',label:'Conditions',description:'Explicit conditions',type:'json' as const,required:false,jsonSchema:{type:'object',properties:{all:{type:'array',items:{type:'string'}}},required:['all'],additionalProperties:false}};
    expect(validateFieldValue(field,{all:['A']})).toBe(true);
    expect(validateFieldValue(field,{all:'A'})).toBe(false);
    expect(validateFieldValue({...field,type:'date',jsonSchema:undefined},'2026-02-30')).toBe(false);
    expect(validateFieldValue({...field,type:'number',jsonSchema:undefined},null)).toBe(false);
  });
});

describe('conservative projections', () => {
  it('checks exact segment-relative spans and source identity', () => {
    expect(validateEvidence(observation.evidence,segment)).toBe(true);
    expect(validateEvidence({...observation.evidence,quote:'7'},segment)).toBe(false);
    expect(validateEvidence({...observation.evidence,sourceVersionId:'wrong'},segment)).toBe(false);
    expect(validateEvidence(observation.evidence,{...segment,quality:'blocked'})).toBe(false);
  });
  it('publishes complete provenance and assigned source families', () => {
    const release = buildPublication(projection());
    expect(release.records[0]?.fields.amount?.value).toBe(6);
    expect(release.records[0]?.fields.amount?.evidence).toEqual([observation.evidence]);
    expect(release.coverage.sourceFamilies).toEqual({registry:1});
    expect(release.warnings.join(' ')).toContain('Synthetic');
    expect(buildPublication(projection()).id).toBe(release.id);
  });
  it('withholds unsupported modes, wrong scope, null, unknown schema and forged spans', () => {
    for (const patch of [{mode:'estimated' as const},{mode:'derived' as const},{scope:{edition:'2025'}},{value:null},{status:'unverified' as const},{schemaId:'old'},{evidence:{...observation.evidence,quote:'7'}}]) {
      expect(buildPublication(projection({observations:[{...observation,...patch}]})).records).toEqual([]);
    }
  });
  it('preserves disagreements without choosing the newest observed value', () => {
    const otherVersion = {...version,id:'v2',sourceId:'src2',url:'https://another.example/data'};
    const otherSegment = {...segment,id:'seg2',sourceVersionId:'v2',text:segment.text.replace('Amount 6','Amount 7')};
    const other = {...observation,id:'o2',value:7,evidence:{...observation.evidence,segmentId:'seg2',sourceVersionId:'v2',quote:'7'}};
    const release = buildPublication(projection({sources:[source,{...source,id:'src2',url:otherVersion.url,latestVersionId:'v2'}],sourceVersions:[version,otherVersion],segments:[segment,otherSegment],observations:[observation,other]}));
    expect(release.records[0]?.fields.amount).toMatchObject({value:null,conflict:true,alternatives:[6,7]});
    expect(release.records[0]?.sourceCount).toBe(2);
  });
  it('uses the source pointer, retains history and never interprets a missing update as absence', () => {
    const newest = {...version,id:'v2',fetchedAt:'2026-10-22T12:00:00.000Z'};
    const newSegment = {...segment,id:'seg2',sourceVersionId:'v2',text:'Code A. Edition 2026.'};
    const code = {...observation,id:'code',field:'code',value:'A',evidence:{sourceVersionId:'v2',segmentId:'seg2',start:5,end:6,quote:'A'}};
    const release = buildPublication(projection({sources:[{...source,latestVersionId:'v2'}],sourceVersions:[version,newest],segments:[segment,newSegment],observations:[observation,code]}));
    expect(release.records[0]?.fields.amount).toBeUndefined();
    expect(release.records[0]?.warnings.join(' ')).toContain('absence is not asserted');
    expect(observation.value).toBe(6);
  });
  it('blocks critical extraction findings and prevents cross-project release chaining', () => {
    const finding = {id:'f',projectId:'p',runId:'run',kind:'extraction' as const,severity:'critical' as const,title:'Wrong assignment',description:'The value is attached to the wrong field',action:'Re-extract',evidence:[observation.evidence],entityId:entity.id,field:'amount',status:'open' as const,resolution:null,createdAt:now};
    expect(buildPublication(projection({findings:[finding]})).records).toEqual([]);
    expect(() => buildPublication(projection({previous:{...buildPublication(projection()),projectId:'other'}}))).toThrow(/different project/);
  });
});
