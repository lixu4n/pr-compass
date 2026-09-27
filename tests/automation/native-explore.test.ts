import { it, expect } from 'vitest'
import { restrictedArgs } from '../../tools/compass/bob-runtime.js'
import { nativeInvestigatorPrompt, parseNativeInvestigation, type NativeDelegationTrace } from '../../tools/compass/native-explore.js'
const trace = (): NativeDelegationTrace => ({requested:3,observed:0,completed:0,verified:false,sessionCostReported:null})
const events = () => [...Array.from({length:3},(_,i)=>[
 {type:'tool_use',tool_name:'spawn_subagent',tool_id:String(i),parameters:{name:'explore'}},
 {type:'tool_result',tool_id:String(i),status:'success'},
]).flat(),{type:'result',status:'success',stats:{session_costs:0.07},last_message:'{"requests":[]}'}]
const stream = (values:unknown[]) => values.map(v=>JSON.stringify(v)).join('\n')
it('enables only native delegation while retaining all other restrictions',()=>{
 const config={bobPath:'bob',acceptLicense:true,nativeExplore:true,maxCost:0.1}
 const args=restrictedArgs('/isolated',config)
 expect(args).not.toContain('--disable-subagents');expect(args).toContain('--disable-mcp')
 expect(args[args.indexOf('--mode')+1]).toBe('ask')
 expect(args[args.indexOf('--format')+1]).toBe('stream-json')
 expect(args[args.indexOf('--disable-tool-groups')+1]).toBe('read,edit,execute,mcp,skill,todo,mode')
 expect(restrictedArgs('/isolated',{...config,nativeExplore:false})).toContain('--disable-subagents')
 expect(nativeInvestigatorPrompt('references')).toContain('exactly three times')
})
it('requires observed successful native events, not model claims',()=>{
 const t=trace();expect(parseNativeInvestigation(stream(events()),t)).toBe('{"requests":[]}')
 expect(t).toEqual({requested:3,observed:3,completed:3,verified:true,sessionCostReported:0.07})
})
it.each([
 [{type:'result',status:'success',last_message:'I used three subagents'}],
 events().slice(2),
 [{type:'tool_use',tool_name:'execute',tool_id:'bad'}],
 [{type:'tool_use',tool_name:'spawn_subagent',tool_id:'bad',parameters:{name:'general'}}],
 [{type:'tool_result',tool_id:'unknown',status:'success'}],
 [{type:'error',message:'limit'}],
 events().map(e=>e.type==='tool_result'?{...e,status:'error'}:e),
 [...events(),{type:'result',status:'success'}],
])('fails closed on missing, failed or unexpected events %#',(...values)=>{
 const t=trace();expect(()=>parseNativeInvestigation(stream(values),t)).toThrow();expect(t.verified).toBe(false)
})
