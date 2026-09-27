import { it, expect, vi } from 'vitest'
import { orchestrate, type AgentCall } from '../../tools/compass/orchestration.js'
import type { CollectionResult, GitHubProvider } from '../../tools/compass/collect.js'
const collection: CollectionResult = {repository:'owner/repo',prNumber:1,prTitle:'Test',prBody:'Document a change.',baseSha:'a'.repeat(40),headSha:'b'.repeat(40),mergeBaseSha:'a'.repeat(40),isFork:false,isDraft:false,isBot:false,omissions:[],sources:[{id:'pr-1',kind:'issue',repository:'owner/repo',commitSha:null,path:null,lines:null,url:'https://github.com/owner/repo/pull/1',snippet:'Document a change.'}]}
const output = {status:'ok',purpose:{summary:'Document a change.',basis:'declared',sourceId:'pr-1',evidence:[{sourceId:'pr-1',quote:'Document a change.'}]},relevantContext:[],readingOrder:[{order:1,label:'PR',reason:'Read the intent.',sourceId:'pr-1'}],limitations:[],unavailableReason:null}
function setup(requests: {path:string;reason:string}[], approved=true) {
 const getContent=vi.fn().mockResolvedValue({type:'file',encoding:'base64',size:12,content:Buffer.from('export {}\n').toString('base64')})
 const call=vi.fn<AgentCall>().mockImplementation(async role=>JSON.stringify(role==='investigator'?{requests}:role==='writer'?output:{approved,concerns:approved?[]:['Unsupported claim']}))
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
 await expect(orchestrate(collection,'instructions',d.provider,d.call)).rejects.toThrow()
 expect(d.call).toHaveBeenCalledTimes(1);expect(d.getContent).not.toHaveBeenCalled()
})
