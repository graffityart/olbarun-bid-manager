import test from 'node:test';
import assert from 'node:assert/strict';
import {runRotation} from '../lib/rotation.ts';
import {resumeSignature,resumeCheckpoint,publicJob} from '../lib/resume-job.ts';
const rows=['a','b','c'].map(id=>({id,group:'group',groupId:'g',keyword:id,siteHost:'lastwar.co.kr',bid:70,min:70,max:100,target:3,step:10}));
function fixture(){let saved,stop=false,pause=null,now=100000;const events=[];const ports={now:()=>now,stopped:async()=>stop,wait:async()=>{},deferReflectionWait:true,checkpoint:async value=>{saved=value;if(pause?.(value))stop=true;},observe:async row=>{events.push('query:'+row.id);return {rank:8,device:'PC',observedAt:now};},manage:async row=>{events.push('manage:'+row.id);return {changed:true,bid:80,status:'increased'};},apply:async()=>{throw Error('unexpected legacy apply')},event:async()=>{}};return {ports,events,get saved(){return saved;},pause(fn){pause=fn;},resume(){pause=null;stop=false;ports.resume=saved;},clock(n){now=n;}};}
test('resume collects only remaining keywords and still completes the scan before bidding',async()=>{
 const f=fixture();f.pause(c=>c.phase==='observe'&&c.nextObserve===2);assert.equal((await runRotation(rows,'PC',180,f.ports)).stopped,true);assert.equal(f.saved.nextObserve,2);assert.ok(!f.events.some(e=>e.startsWith('manage')));
 f.resume();f.events.length=0;await runRotation(rows,'PC',180,f.ports);assert.deepEqual(f.events,['query:c','query:a','manage:a','query:b','manage:b','manage:c']);assert.equal(f.saved.phase,'complete');
});
test('resume skips completed writes and refreshes remaining stale ranks',async()=>{
 const f=fixture();f.pause(c=>c.phase==='manage'&&c.nextManage===1);await runRotation(rows,'PC',180,f.ports);assert.equal(f.saved.nextManage,1);f.resume();f.clock(200001);f.events.length=0;
 const result=await runRotation(rows,'PC',180,f.ports);assert.deepEqual(f.events,['query:b','manage:b','query:c','manage:c']);assert.equal(result.changes,3);
});
test('first-from-beginning scans all keywords again, without resetting their bids',async()=>{
 const f=fixture();f.pause(c=>c.phase==='manage'&&c.nextManage===1);await runRotation(rows,'PC',180,f.ports);f.resume();delete f.ports.resume;f.events.length=0;await runRotation(rows.map(r=>({...r,bid:80})),'PC',180,f.ports);assert.deepEqual(f.events.slice(0,3),['query:a','query:b','query:c']);
});
const job={group:'g',device:'PC',waitSeconds:180,strategy:'increase',lowestRank:null,ids:['a','b','c']};
const cp={version:1,ids:job.ids,device:'PC',phase:'manage',nextObserve:3,nextManage:0,changes:0,observations:{},pendingManageId:'a',pendingStartedAt:100000};
const signature=resumeSignature(rows,job),previous={...job,state:'stopped',resumeSignature:signature,checkpoint:cp};
test('confirmed write before checkpoint persistence is skipped; ambiguous write blocks resume',()=>{
 const confirmed=resumeCheckpoint(previous,signature,[{keywordId:'a',time:new Date(100001).toISOString(),state:'confirmed'}]);assert.equal(confirmed.nextManage,1);assert.equal(confirmed.changes,1);assert.equal(confirmed.pendingManageId,undefined);
 assert.throws(()=>resumeCheckpoint(previous,signature,[{keywordId:'a',time:new Date(100001).toISOString(),state:'pending'}]),/확정/);
});
test('changed settings, device, host, keyword order and failed jobs cannot resume',()=>{
 for(const changed of [{...job,device:'MOBILE'},{...job,waitSeconds:120},{...job,ids:['b','a','c']}])assert.throws(()=>resumeCheckpoint(previous,resumeSignature(rows,changed),[]));
 assert.throws(()=>resumeCheckpoint(previous,resumeSignature(rows.map(r=>({...r,max:110})),job),[]));assert.throws(()=>resumeCheckpoint({...previous,state:'failed'},signature,[]));
 assert.equal(resumeSignature(rows.map(r=>({...r,bid:90})),job),signature);
});
test('public jobs expose progress without sending observation snapshots or signatures to browser',()=>{
 const exposed=publicJob(previous);assert.equal(exposed.checkpoint.nextManage,0);assert.equal(exposed.checkpoint.observations,undefined);assert.equal(exposed.resumeSignature,undefined);assert.equal(exposed.checkpoint.total,3);
});
