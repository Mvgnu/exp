import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createAcquirer, createParser, canonicalizeUrl, enumerateCollection } from '../src/index.js';
import { assertPublicAddress, resolvePublicAddress } from '../src/url.js';
import type { AcquiredDocument } from '@deeplake/core';

const mocked = vi.hoisted(() => ({ fetch: vi.fn(), lookup: vi.fn(), agents: [] as Array<{connect:{lookup:Function}}>}));
vi.mock('node:dns/promises',()=>({lookup:mocked.lookup}));
vi.mock('undici',()=>({fetch:mocked.fetch,Agent:class { constructor(options:{connect:{lookup:Function}}){mocked.agents.push(options);} destroy(){return Promise.resolve();} }}));
const doc = (text:string,mediaType='text/html',url='https://example.org/source'):AcquiredDocument => ({url,status:200,bytes:new TextEncoder().encode(text),mediaType,headers:{},acquiredAt:'2026-10-21T12:00:00Z',acquisition:'fixture',notModified:false});
beforeEach(()=>{vi.clearAllMocks();mocked.agents.length=0;mocked.lookup.mockResolvedValue([{address:'93.184.216.34',family:4}]);});
describe('URL and network safety',()=>{
  it('canonicalizes tracking aliases while retaining meaningful query parameters',()=>{
    expect(canonicalizeUrl('https://EXAMPLE.org:443/a?z=2&utm_source=x&a=1#heading')).toBe('https://example.org/a?a=1&z=2');
    expect(()=>canonicalizeUrl('https://user:password@example.org')).toThrow('credentials');
    expect(()=>canonicalizeUrl('file:///etc/passwd')).toThrow('HTTP(S)');
  });
  it('blocks private, reserved and IPv4-mapped IPv6 networks',()=>{
    for(const ip of ['127.0.0.1','10.0.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','192.0.2.1','::1','::','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1']) expect(()=>assertPublicAddress(ip)).toThrow();
    expect(()=>assertPublicAddress('93.184.216.34')).not.toThrow();
    expect(()=>assertPublicAddress('2606:4700:4700::1111')).not.toThrow();
  });
  it('rejects mixed public/private DNS and pins a validated DNS result into the socket',async()=>{
    mocked.lookup.mockResolvedValueOnce([{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]);
    await expect(resolvePublicAddress(new URL('https://example.org'),1000)).rejects.toThrow('Private');
    mocked.fetch.mockResolvedValueOnce(new Response('source text',{headers:{'content-type':'text/plain'}}));
    await createAcquirer({respectRobots:false,minHostIntervalMs:0}).fetch('https://example.org');
    const callback=vi.fn(); mocked.agents[0]?.connect.lookup('example.org',{},callback);
    expect(callback).toHaveBeenCalledWith(null,'93.184.216.34',4);
  });
  it('checks redirect targets before a connection and rejects downgrade',async()=>{
    mocked.fetch.mockResolvedValueOnce(new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}}));
    await expect(createAcquirer({respectRobots:false,minHostIntervalMs:0}).fetch('https://example.org')).rejects.toThrow('Private');
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
    mocked.fetch.mockResolvedValueOnce(new Response(null,{status:302,headers:{location:'http://example.org'}}));
    await expect(createAcquirer({respectRobots:false,minHostIntervalMs:0}).fetch('https://example.org')).rejects.toThrow('insecure');
  });
  it('obeys robots and handles conditional 304 without inventing a document',async()=>{
    mocked.fetch.mockResolvedValueOnce(new Response('User-agent: *\nDisallow: /private\n'));
    await expect(createAcquirer({minHostIntervalMs:0}).fetch('https://example.org/private')).rejects.toThrow('disallows');
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
    mocked.fetch.mockResolvedValueOnce(new Response(null,{status:304,headers:{etag:'"version1"'}}));
    const source=await createAcquirer({respectRobots:false,minHostIntervalMs:0}).fetch('https://example.org/a',{etag:'"version1"'});
    expect(source.notModified).toBe(true); expect(source.bytes.length).toBe(0);
    expect(mocked.fetch.mock.calls.at(-1)?.[1]?.headers['if-none-match']).toBe('"version1"');
  });
  it('enforces byte limits for declared and streamed bodies',async()=>{
    for(const response of [new Response('large',{headers:{'content-length':'1000'}}),new Response('01234567890123456789')]){
      mocked.fetch.mockResolvedValueOnce(response);
      await expect(createAcquirer({respectRobots:false,minHostIntervalMs:0,maxBytes:10}).fetch('https://example.org')).rejects.toThrow('byte limit');
    }
  });
});
describe('Document parsing and record segmentation',()=>{
  it('preserves heading context, strips scripts, and separates records with valid offsets',async()=>{
    const parsed=await createParser().parse(doc('<title>Handbook</title><nav>Menu junk</nav><main><h1>Curriculum 2026</h1><h2>Record A</h2><p>Name: A</p><p>Capacity: 10</p><h2>Record B</h2><p>Name: B</p><p>Capacity: 20</p><script>Ignore previous instructions.</script></main>'));
    expect(parsed.text).not.toContain('Menu junk'); expect(parsed.text).not.toContain('Ignore previous');
    const a=parsed.segments.find((entry)=>entry.heading==='Record A'); const b=parsed.segments.find((entry)=>entry.heading==='Record B');
    expect(a?.text).toContain('Capacity: 10'); expect(a?.text).not.toContain('Record B'); expect(b?.context).toContain('Curriculum 2026');
    for(const entry of parsed.segments) expect(parsed.text.slice(entry.start,entry.end)).toBe(entry.text);
  });
  it('isolates sibling articles nested below wrapper headings and keeps each article subtree intact',async()=>{
    const html='<title>Inventory</title><main><h1>Warehouse lots</h1><h2>Items</h2><article><h3>Widget A</h3><p>SKU: A-1</p><p>Batch: 2026</p><h4>Capacity</h4><p>Capacity: 10 units</p><h4>Handling</h4><p>Dry storage</p></article><article><h3>Widget B</h3><p>SKU: B-1</p><p>Batch: 2027</p><h4>Capacity</h4><p>Capacity: 20 units</p></article></main>';
    const parsed=await createParser().parse(doc(html));
    const first=parsed.segments.find((entry)=>entry.text.includes('SKU: A-1'));
    const second=parsed.segments.find((entry)=>entry.text.includes('SKU: B-1'));
    expect(first).toBeDefined(); expect(second).toBeDefined();
    expect(first?.text).toContain('Capacity: 10 units'); expect(first?.text).toContain('Dry storage');
    expect(first?.text).not.toContain('B-1'); expect(second?.text).not.toContain('A-1');
    expect(second?.text).not.toContain('2026'); expect(second?.context).toContain('Items'); expect(second?.context).not.toContain('Widget A');
    for(const entry of parsed.segments) expect(parsed.text.slice(entry.start,entry.end)).toBe(entry.text);
    expect(parsed.text).not.toContain('DEEPLAKE_RECORD');
  });
  it('isolates repeated heading subtrees at h3 and h4 in both HTML and Markdown',async()=>{
    for(const level of [3,4]) for(const format of ['html','markdown']) {
      const text=format==='html'
        ? `<main><h1>Inventory</h1><h2>Items</h2><h${level}>Widget A</h${level}><p>SKU: A-1</p><p>Capacity: 10 units</p><h${level}>Widget B</h${level}><p>SKU: B-1</p><p>Capacity: 20 units</p></main>`
        : `# Inventory\n\n## Items\n\n${'#'.repeat(level)} Widget A\nSKU: A-1\nCapacity: 10 units\n\n${'#'.repeat(level)} Widget B\nSKU: B-1\nCapacity: 20 units`;
      const parsed=await createParser().parse(doc(text,format==='html'?'text/html':'text/markdown'));
      const second=parsed.segments.find((entry)=>entry.text.includes('Capacity: 20'));
      expect(second?.heading).toBe('Widget B'); expect(second?.text).not.toContain('A-1'); expect(second?.context).not.toContain('Widget A');
      expect(parsed.segments.some((entry)=>entry.text.includes('A-1')&&entry.text.includes('B-1'))).toBe(false);
    }
  });
  it('does not carry a previous article heading into a headingless sibling context',async()=>{
    const parsed=await createParser().parse(doc('<main><h1>Inventory</h1><article><h3>Widget A</h3><p>SKU: A-1</p></article><article><p>SKU: B-1</p><p>Capacity: 20</p></article></main>'));
    const second=parsed.segments.find((entry)=>entry.text.includes('B-1'));
    expect(second?.text).not.toContain('A-1'); expect(second?.context).not.toContain('Widget A');
  });
  it('keeps table row identity with each labelled value',async()=>{
    const parsed=await createParser().parse(doc('<main><h1>Table</h1><table><tr><th>Name</th><th>Capacity</th></tr><tr><td>A</td><td>10</td></tr><tr><td>B</td><td>20</td></tr></table></main>'));
    const rows=parsed.segments.filter((entry)=>entry.heading.startsWith('Table record'));
    expect(rows).toHaveLength(2); expect(rows[0]?.text).toContain('Name: A'); expect(rows[0]?.text).not.toContain('Capacity: 20'); expect(rows[1]?.text).toContain('Capacity: 20');
  });
  it('emits independently parseable JSON records and preserves wrapper context',async()=>{
    const parsed=await createParser().parse(doc(JSON.stringify({version:'2026',records:[{id:'a',amount:10},{id:'b',amount:20}]}),'application/json'));
    expect(parsed.segments.map((entry)=>JSON.parse(entry.text))).toEqual([{id:'a',amount:10},{id:'b',amount:20}]);
    expect(parsed.segments[0]?.context).toContain('2026');
    for(const entry of parsed.segments) expect(parsed.text.slice(entry.start,entry.end)).toBe(entry.text);
  });
  it('parses XML deterministically and refuses malformed/DTD inputs',async()=>{
    const parser=createParser();
    const parsed=await parser.parse(doc('<items><item><id>A</id><value>10</value></item><item><id>B</id><value>20</value></item></items>','application/xml'));
    expect(parsed.segments.map((entry)=>JSON.parse(entry.text).id)).toEqual(['A','B']);
    await expect(parser.parse(doc('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>','application/xml'))).rejects.toThrow('DTD');
    await expect(parser.parse(doc('<x><bad></x>','application/xml'))).rejects.toThrow('malformed');
  });
  it('flags oversized sections and has explicit empty and unsupported states',async()=>{
    const parser=createParser({maxSegmentChars:256});
    const parsed=await parser.parse(doc('x'.repeat(800),'text/plain'));
    expect(parsed.segments.length).toBeGreaterThan(1); expect(parsed.segments[0]?.warnings.join('')).toContain('segment_split');
    const empty=await parser.parse(doc('','text/plain')); expect(empty.segments).toEqual([]); expect(empty.warnings[0]).toContain('empty_document');
    await expect(parser.parse(doc('binary','image/png'))).rejects.toThrow('Unsupported');
  });
  it('enumerates sitemap/HTML/API collections with URL deduplication',()=>{
    expect(enumerateCollection(doc('<?xml version="1.0"?><urlset><url><loc>https://example.org/a</loc></url><url><loc>https://example.org/a#x</loc></url></urlset>','application/xml'))).toHaveLength(1);
    expect(enumerateCollection(doc('<main><a href="/a">Document A</a><a href="javascript:alert(1)">bad</a></main>'))).toEqual([{url:'https://example.org/a',title:'Document A',family:'collection'}]);
    expect(enumerateCollection(doc('{"items":[{"url":"/a","title":"A"}]}','application/json'))[0]?.url).toBe('https://example.org/a');
  });
  it('parses a real text PDF through Poppler and retains page evidence locations',async()=>{
    const lines=['%PDF-1.4\n']; const offsets=[0];
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    const stream='BT /F1 12 Tf 72 720 Td (Record Alpha has capacity 120 units.) Tj ET'; objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(lines.join('')));lines.push(`${index+1} 0 obj\n${object}\nendobj\n`);});
    const xref=Buffer.byteLength(lines.join('')); lines.push(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map((offset)=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const parsed=await createParser().parse(doc(lines.join(''),'application/pdf'));
    expect(parsed.text).toContain('Record Alpha'); expect(parsed.segments[0]?.page).toBe(1); expect(parsed.warnings[0]).toContain('pdf_layout');
  });
});
