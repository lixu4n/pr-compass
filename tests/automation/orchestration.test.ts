import { it, expect, vi } from 'vitest'
import { orchestrate, type AgentCall } from '../../tools/compass/orchestration.js'
import type { CollectionResult, GitHubProvider } from '../../tools/compass/collect.js'
const collection: CollectionResult = {repository:'owner/repo',prNumber:1,prTitle:'Test',prBody:'Document a change.',baseSha:'a'.repeat(40),headSha:'b'.repeat(40),mergeBaseSha:'a'.repeat(40),isFork:false,isDraft:false,isBot:false,omissions:[],sources:[{id:'pr-1',kind:'issue',repository:'owner/repo',commitSha:null,path:null,lines:null,url:'https://github.com/owner/repo/pull/1',snippet:'Document a change.'}]}
const output = {status:'ok',purpose:{summary:'Document a change.',basis:'declared',sourceId:'pr-1',evidence:[{sourceId:'pr-1',quote:'Document a change.'}]},relevantContext:[],readingOrder:[{order:1,label:'PR',reason:'Read the intent.',sourceId:'pr-1'}],limitations:[],unavailableReason:null}
function setup(requests: {path:string;reason:string}[], approved=true) {
 const getContent=vi.fn().mockResolvedValue({type:'file',encoding:'base64',size:12,content:Buffer.from('export {}\n').toString('base64')})
 const call=vi.fn<AgentCall>().mockImplementation(async role=>JSON.stringify(role==='investigator'?{requests}:role==='writer'?output:{verdict:approved?'supported':'unsupported',findings:approved?[]:[{statementId:'purpose',explanation:'Unsupported claim',sourceIds:['pr-1']}]}))
 return {getContent,call,provider:{getContent} as unknown as GitHubProvider}
}
it('runs distinct roles once, shares the budget, and pins retrieval to the analyzed head',async()=>{
 const d=setup([{path:'src/test.ts',reason:'Read related test'}]);const result=await orchestrate(collection,'instructions',d.provider,d.call)
 expect(result.ok).toBe(true);expect(d.call.mock.calls.map(c=>c[0])).toEqual(['investigator','writer','reviewer'])
 expect(d.call.mock.calls.reduce((sum,c)=>sum+c[2],0)).toBeCloseTo(0.5)
 expect(d.getContent).toHaveBeenCalledWith('owner','repo','src/test.ts',collection.headSha)
 expect(collection.sources).toHaveLength(1)
})
it('rejects traversal and secret requests without fetching them',async()=>{
 const d=setup([{path:'../outside.ts',reason:'bad'},{path:'.env',reason:'bad'},{path:'secrets/key.js',reason:'bad'}])
 await orchestrate(collection,'instructions',d.provider,d.call);expect(d.getContent).not.toHaveBeenCalled()
})
it('stops when the reviewer rejects, without retrying',async()=>{
 const d=setup([],false);const result=await orchestrate(collection,'instructions',d.provider,d.call)
 expect(result.ok).toBe(false);expect(d.call).toHaveBeenCalledTimes(3)
})
it('rejects plans with more than three requests before retrieval or writing',async()=>{
 const d=setup(Array.from({length:4},(_,i)=>({path:`file${i}.ts`,reason:'test'})))
 expect((await orchestrate(collection,'instructions',d.provider,d.call)).ok).toBe(false)
 expect(d.call).toHaveBeenCalledTimes(1);expect(d.getContent).not.toHaveBeenCalled()
})

async function withOutputs(writer: unknown = output, checker: unknown = {verdict:'supported',findings:[]}, input = collection) {
 const d=setup([])
 d.call.mockImplementation(async role => role === 'investigator' ? '{"requests":[]}' :
   role === 'writer' ? (typeof writer === 'string' ? writer : JSON.stringify(writer)) : JSON.stringify(checker))
 return { result: await orchestrate(input, 'TRUSTED WRITER INSTRUCTIONS', d.provider, d.call), ...d }
}
it.each([
 ['malformed JSON','not json'],
 ['extra nested field',{...output,purpose:{...output.purpose, invented:true}}],
 ['missing excerpts',{...output,purpose:{...output.purpose,evidence:undefined}}],
 ['unknown citation',{...output,readingOrder:[{...output.readingOrder[0],sourceId:'fake'}]}],
 ['invented excerpt',{...output,purpose:{...output.purpose,evidence:[{sourceId:'pr-1',quote:'Fabricated content'}]}}],
 ['wrong excerpt source',{...output,purpose:{...output.purpose,evidence:[{sourceId:'fake',quote:'Document a change.'}]}}],
 ['duplicate orders',{...output,readingOrder:[output.readingOrder[0],output.readingOrder[0]]}],
 ['unavailable',{...output,status:'unavailable',purpose:null,readingOrder:[],unavailableReason:'Missing evidence'}],
 ['empty partial',{...output,status:'partial',purpose:null,readingOrder:[],unavailableReason:'Missing evidence'}],
 ['partial without reason',{...output,status:'partial'}],
 ['ok with reason',{...output,unavailableReason:'Contradiction'}],
 ['empty reading reason',{...output,readingOrder:[{...output.readingOrder[0],reason:' '}]}],
 ['context without excerpts',{...output,relevantContext:[{statement:'Document a change.',basis:'declared',sourceIds:['pr-1']}]}],
])('stops invalid writer output before checker: %s', async (_name, writer) => {
 const d=await withOutputs(writer)
 expect(d.result.ok).toBe(false);expect(d.call).toHaveBeenCalledTimes(2)
 expect(d.call.mock.calls.map(c=>c[0])).toEqual(['investigator','writer'])
})
it('runs full provenance validation before the checker',async()=>{
 const d=await withOutputs(output,undefined,{...collection,baseSha:collection.headSha})
 expect(d.result.ok).toBe(false);expect(d.call).toHaveBeenCalledTimes(2)
})
it.each([
 {verdict:'approved',findings:[]},
 {verdict:'supported',findings:[],extra:true},
 {verdict:'insufficient_evidence',findings:[]},
 {verdict:'unsupported',findings:[{statementId:'invented',explanation:'Missing',sourceIds:[]}]},
 {verdict:'unsupported',findings:[{statementId:'purpose',explanation:'Missing',sourceIds:['invented']}]},
 {verdict:'supported',findings:[{statementId:'purpose',explanation:'Missing',sourceIds:[]}]},
 {verdict:'unsupported',findings:[{statementId:'purpose',explanation:'Missing',sourceIds:[],extra:true}]},
])('rejects invalid checker contract or references: %j',async checker=>{
 const d=await withOutputs(output,checker);expect(d.result.ok).toBe(false);expect(d.call).toHaveBeenCalledTimes(3)
 expect(d.result).not.toHaveProperty('brief')
})
it.each(['unsupported','insufficient_evidence'])('withholds candidate on %s without retries',async verdict=>{
 const d=await withOutputs(output,{verdict,findings:[{statementId:'reading-1',explanation:'Evidence missing',sourceIds:[]}]})
 expect(d.result.ok).toBe(false);expect(d.result).not.toHaveProperty('brief');expect(d.call).toHaveBeenCalledTimes(3)
})
it.each([{requests:[],commit:'other'},{requests:[{path:'src/a.ts',reason:'test',repository:'other/repo'}]}])('rejects extra plan fields before retrieval: %j',async plan=>{
 const d=setup([]);d.call.mockResolvedValue(JSON.stringify(plan))
 expect((await orchestrate(collection,'instructions',d.provider,d.call)).ok).toBe(false)
 expect(d.call).toHaveBeenCalledTimes(1);expect(d.getContent).not.toHaveBeenCalled()
})

it.each(['.github/workflows/manual.yml','.github/workflows/auto.yaml'])('fetches allowed workflow at exact head: %s',async path=>{
 const d=setup([{path,reason:'Check trigger'}]);const r=await orchestrate(collection,'instructions',d.provider,d.call)
 expect(r.ok).toBe(true);expect(d.getContent).toHaveBeenCalledWith('owner','repo',path,collection.headSha)
 expect(r.retrieval[0].sourceIds).toHaveLength(1)
})
it.each(['/absolute.ts','https://evil/a.ts','.github/other.yml','.github/workflows/../a.yml','vendor/a.ts','credentials/a.ts','private-key.ts'])('rejects forbidden path %s',async path=>{
 const d=setup([{path,reason:'bad'}]);await orchestrate(collection,'instructions',d.provider,d.call)
 expect(d.getContent).not.toHaveBeenCalled()
})
it('expands truncated code once and preserves initial sources',async()=>{
 const d=setup([{path:'src/a.ts',reason:'Expand'},{path:'src/a.ts',reason:'Again'}])
 const input={...collection,sources:[...collection.sources,{...collection.sources[0],id:'snippet',kind:'code' as const,commitSha:collection.headSha,path:'src/a.ts',lines:'1-1',snippet:'export'}]}
 const r=await orchestrate(input,'instructions',d.provider,d.call)
 expect(d.getContent).toHaveBeenCalledTimes(1);expect(r.retrieval[0].sourceIds).toHaveLength(1)
 if (!r.ok) throw new Error(r.reason)
 expect(r.brief.sources).toHaveLength(3);expect(input.sources).toHaveLength(2)
})
it('reuses an equivalent full source without duplication',async()=>{
 const d=setup([{path:'src/a.ts',reason:'Read'}])
 const input={...collection,sources:[...collection.sources,{...collection.sources[0],id:'full',kind:'code' as const,commitSha:collection.headSha,path:'src/a.ts',snippet:'export {}\n'}]}
 const r=await orchestrate(input,'instructions',d.provider,d.call)
 expect(r.retrieval[0].sourceIds).toEqual(['full']);if(r.ok) expect(r.brief.sources).toHaveLength(2)
})
it('enforces per-file and total additional byte limits',async()=>{
 const d=setup(['a.ts','b.ts','c.ts'].map(path=>({path,reason:'Read'})))
 d.getContent.mockResolvedValue({type:'file',encoding:'base64',size:12000,content:Buffer.alloc(12000,65).toString('base64')})
 const r=await orchestrate(collection,'instructions',d.provider,d.call)
 expect(r.retrieval.map(x=>x.outcome)).toEqual(['collected at analyzed head','collected at analyzed head','retrieval budget exceeded'])
 d.getContent.mockResolvedValue({type:'file',encoding:'base64',size:12001,content:'QQ=='})
 const large=await orchestrate(collection,'instructions',d.provider,d.call)
 expect(large.retrieval.every(x=>x.sourceIds.length===0)).toBe(true)
})
it.each(['investigator','writer','reviewer'])('returns sanitized failure and no retries when %s throws',async role=>{
 const d=setup([]);const original=d.call.getMockImplementation()!
 d.call.mockImplementation(async (...args)=>{if(args[0]===role) throw new Error('sensitive provider payload');return original(...args)})
 const r=await orchestrate(collection,'instructions',d.provider,d.call)
 expect(r.ok).toBe(false);expect(JSON.stringify(r)).not.toContain('sensitive provider payload')
 expect(r.trace.at(-1)?.outcome).toBe('failed');expect(d.call).toHaveBeenCalledTimes(['investigator','writer','reviewer'].indexOf(role)+1)
})
it('returns retrieval failures without spending on writer',async()=>{
 const d=setup([{path:'src/a.ts',reason:'Read'}]);d.getContent.mockRejectedValue(new Error('secret raw error'))
 const r=await orchestrate(collection,'instructions',d.provider,d.call)
 expect(r.ok).toBe(false);expect(r.retrieval[0].outcome).toBe('retrieval failed');expect(d.call).toHaveBeenCalledTimes(1)
 expect(JSON.stringify(r)).not.toContain('secret raw error')
})
it('checks cancellation and freshness between calls',async()=>{
 const d=setup([]);const check=vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false)
 const stale=await orchestrate(collection,'instructions',d.provider,d.call,0.5,{check})
 expect(stale.ok).toBe(false);expect(d.call).toHaveBeenCalledTimes(1)
 const c=new AbortController();c.abort();d.call.mockClear()
 expect((await orchestrate(collection,'instructions',d.provider,d.call,0.5,{signal:c.signal})).ok).toBe(false)
 expect(d.call).not.toHaveBeenCalled()
})
