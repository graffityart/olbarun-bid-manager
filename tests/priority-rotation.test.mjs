import test from 'node:test';
import assert from 'node:assert/strict';
import {runPriorityRotation,nextScheduled} from '../lib/priority-rotation.ts';
import {resumeCheckpoint,resumeSignature,publicJob} from '../lib/resume-job.ts';
import {serialWork} from '../lib/shared-work.ts';
const rows=['a','b','c','d'].map(id=>({id,bid:700,min:70,max:2000,target:3,group:'g',keyword:id,siteHost:'lastwar.co.kr'}));
function fixture(){let now=1000000,stop=false,saved;const events=[];const ports={now:()=>now,stopped:async()=>stop,wait:async s=>{now+=s*1000;},checkpoint:async cp=>{saved=cp;},observe:async r=>{events.push('query:'+r.id);return {rank:8,source:'MAIN',observedAt:now,device:'PC'};},manage:async r=>{events.push('manage:'+r.id);return {changed:true,status:'increased',bid:1000};},event:async()=>{},apply:async()=>{throw Error('legacy must not be used')}};return {ports,events,stop(){stop=true;},resume(){stop=false;},advance(s){now+=s*1000;},get saved(){return saved;}};}
test('each query is managed immediately without waiting for full scan or a second query',async()=>{
 const f=fixture();await runPriorityRotation(rows,'PC',180,f.ports);assert.deepEqual(f.events,['query:a','manage:a','query:b','manage:b','query:c','manage:c','query:d','manage:d']);assert.equal(f.saved.phase,'complete');assert.equal(f.saved.changes,4);
});
test('due urgent keyword returns before whole population; reflection wait lets other keywords run',async()=>{
 const f=fixture();f.ports.manage=async r=>{f.events.push('manage:'+r.id);f.advance(90);return {changed:true,status:'increased',bid:1000};};
 await runPriorityRotation([...rows,{...rows[0],id:'e'},{...rows[0],id:'f'}],'PC',180,f.ports);
 assert.ok(f.events.indexOf('query:b')<f.events.lastIndexOf('query:a'));assert.ok(f.events.filter(x=>x==='query:a').length>1);
});
test('priority selection shares background slots after at most three urgent slots',()=>{
 const ids=['a','b','c','d'];const q={entries:Object.fromEntries(ids.map((id,i)=>[id,{dueAt:0,priority:i<3?0:2,lastRun:i}])),turn:3,urgentBurst:3};
 assert.equal(nextScheduled(ids,q,1000),'d');q.entries.d.dueAt=2000;assert.equal(nextScheduled(ids,q,1000),'a');
});
test('known goals and unknown results are revisited less often, without writes for unknown',async()=>{
 const f=fixture();f.ports.observe=async r=>({rank:r.id==='a'?null:3,source:'MAIN',device:'PC',observedAt:f.ports.now()});f.ports.manage=async(r,o)=>({changed:false,status:o.rank===null?'unknown':'monitoring',bid:700});
 const d=await runPriorityRotation(rows,'PC',180,f.ports);assert.equal(d.queue.entries.a.priority,1);assert.equal(d.queue.entries.b.priority,2);assert.equal(d.queue.entries.a.dueAt,1300000);assert.equal(d.queue.entries.b.dueAt,1600000);
});
test('stop after pending confirmation reconciles resume without a duplicate write',async()=>{
 const f=fixture();const original=f.ports.manage;f.ports.manage=async(...args)=>{const result=await original(...args);f.stop();return result;};
 // Simulate loss after confirmed PUT but before the scheduler advances.
 f.ports.event=async()=>{throw Error('connection lost after confirmed write')};
 await assert.rejects(()=>runPriorityRotation(rows,'PC',180,f.ports));const cp=f.saved;assert.equal(cp.pendingManageId,'a');
 const job={group:'g',device:'PC',waitSeconds:180,strategy:'cost',policyVersion:'adaptive-300-v1',ids:rows.map(r=>r.id)};const sig=resumeSignature(rows,job);
 const previous={...job,state:'stopped',checkpoint:cp,resumeSignature:sig};
 assert.throws(()=>resumeCheckpoint(previous,sig,[{state:'pending'}]),/확정/);
 const reconciled=resumeCheckpoint(previous,sig,[{state:'confirmed',keywordId:'a',time:new Date(cp.pendingStartedAt).toISOString()}]);assert.equal(reconciled.nextManage,1);
 f.resume();f.events.length=0;f.ports.manage=original;f.ports.event=async()=>{};f.ports.resume=reconciled;await runPriorityRotation(rows,'PC',180,f.ports);
 assert.ok(!f.events.includes('manage:a'));assert.equal(f.saved.nextManage,4);
 assert.equal(publicJob(previous).checkpoint.queue,undefined);
});
test('stop before a write does not manage a keyword and resumed query waits safely',async()=>{
 const f=fixture();const persist=f.ports.checkpoint;f.ports.checkpoint=async cp=>{await persist(cp);if(cp.pendingManageId)f.stop();};
 await runPriorityRotation(rows,'PC',180,f.ports);assert.ok(!f.events.some(e=>e.startsWith('manage')));
 const job={group:'g',device:'PC',waitSeconds:180,strategy:'cost',policyVersion:'adaptive-300-v1',ids:rows.map(r=>r.id)};const sig=resumeSignature(rows,job);
 const cp=resumeCheckpoint({...job,state:'stopped',checkpoint:f.saved,resumeSignature:sig},sig,[]);assert.equal(cp.nextManage,0);
 f.resume();f.ports.checkpoint=persist;f.ports.resume=cp;await runPriorityRotation(rows,'PC',180,f.ports);assert.equal(f.saved.phase,'complete');
});
test('denied search aborts before any bid; invalid or stale observations are passed as unknown',async()=>{
 const f=fixture();f.ports.observe=async()=>{const e=Error('403');e.name='SearchAccessDenied';throw e;};
 await assert.rejects(()=>runPriorityRotation(rows,'PC',180,f.ports),/403/);assert.equal(f.events.length,0);
 const g=fixture();g.ports.observe=async()=>({rank:8,source:'MAIN',device:'MOBILE',observedAt:1000000});g.ports.manage=async(r,o)=>{assert.equal(o.rank,null);return {changed:false,status:'unknown',bid:700};};await runPriorityRotation(rows,'PC',180,g.ports);
});
test('two groups serialize search and write while stopping independently',async()=>{
 const work=serialWork(),a=fixture(),b=fixture();let concurrent=0,peak=0;
 for(const f of [a,b]){const observe=f.ports.observe,manage=f.ports.manage;f.ports.observe=(...args)=>work(async()=>{concurrent++;peak=Math.max(peak,concurrent);const o=await observe(...args);concurrent--;return o;});f.ports.manage=(...args)=>work(()=>manage(...args));}
 const observeA=a.ports.observe;a.ports.observe=async(...args)=>{const o=await observeA(...args);a.stop();return o;};
 const result=await Promise.all([runPriorityRotation(rows,'PC',180,a.ports),runPriorityRotation(rows,'PC',180,b.ports)]);assert.equal(result[0].stopped,true);assert.equal(result[1].changes,4);assert.equal(peak,1);
});

test('integrated scheduler follows 300 then 50 increases, two checks, ten reduction and exact restore',async()=>{
 const {costDecision,costApplied}=await import('../lib/cost-policy.ts');
 const row={...rows[0],bid:700};let now=1000000,policy,queue;const writes=[];
 const ports={now:()=>now,stopped:async()=>false,wait:async seconds=>{now+=seconds*1000;},checkpoint:async()=>{},event:async()=>{},apply:async()=>{throw Error('legacy');},
 observe:async()=>({rank:row.bid<1000?9:row.bid<1100?5:3,source:'MAIN',device:'PC',observedAt:now}),
 manage:async(r,o)=>{const d=costDecision({bid:row.bid,min:70,max:2000,target:3,rank:o.rank,source:o.source,device:'PC',group:'g',observedAt:o.observedAt,now,waitSeconds:180,stableChecks:2,exactRank:true,reductionAmount:10},policy);policy=d.state;if(d.action==='hold')return {changed:false,status:'monitoring',bid:row.bid};writes.push([d.action,row.bid,d.next]);policy=costApplied(policy,d.action,row.bid,d.next,now);row.bid=d.next;return {changed:true,status:d.action==='increase'?'increased':d.action==='reduce'?'reduced':'restored',bid:row.bid};}};
 for(let i=0;i<7;i++){const r=await runPriorityRotation([row],'PC',180,{...ports,queue});queue=r.queue;}
 assert.deepEqual(writes,[['increase',700,1000],['increase',1000,1050],['increase',1050,1100],['reduce',1100,1090],['restore',1090,1100]]);
});
