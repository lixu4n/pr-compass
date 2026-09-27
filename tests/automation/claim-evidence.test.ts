import { describe, it, expect } from 'vitest'
import { assembleBrief } from '../../tools/compass/analyze.js'
import type { CollectionResult } from '../../tools/compass/collect.js'
import type { ModelOutput } from '../../src/types/ContextBrief.js'
const snippet = 'The manual workflow requests a limit of 0.5 Bobcoins.'
const collection: CollectionResult = {
 repository:'test/repo',prNumber:1,prTitle:'Demo',prBody:snippet,baseSha:'a'.repeat(40),headSha:'b'.repeat(40),mergeBaseSha:'a'.repeat(40),isFork:false,isDraft:false,isBot:false,omissions:[],
 sources:[{id:'pr-1',kind:'issue',repository:'test/repo',commitSha:null,path:null,lines:null,url:'https://github.com/test/repo/pull/1',snippet}],
}
function output(quote: string): ModelOutput { return {status:'ok',purpose:{summary:'Document requested usage limits.',basis:'declared',sourceId:'pr-1',evidence:[{sourceId:'pr-1',quote}]},relevantContext:[],readingOrder:[{order:1,label:'PR description',reason:'Read the stated intent.',sourceId:'pr-1'}],limitations:[],unavailableReason:null} }
describe('claim evidence provenance',()=>{
 it('accepts an exact supplied excerpt',()=>expect(assembleBrief(output(snippet),collection,'test').ok).toBe(true))
 it('rejects invented quotes even when the source ID exists',()=>expect(assembleBrief(output('Guaranteed maximum cost is 0.5 Bobcoins.'),collection,'test').ok).toBe(false))
 it('rejects evidence attached to a different citation',()=>{const o=output(snippet);o.purpose!.evidence![0].sourceId='other';expect(assembleBrief(o,collection,'test').ok).toBe(false)})
 it('does not mistake exact quotation for factual entailment',()=>{const o=output(snippet);o.purpose!.summary='All automatic runs have guaranteed billing caps.';expect(assembleBrief(o,collection,'test').ok).toBe(true)})
})
