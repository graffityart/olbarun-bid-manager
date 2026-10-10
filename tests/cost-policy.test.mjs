import test from 'node:test';
import assert from 'node:assert/strict';
import {costDecision,costApplied} from '../lib/cost-policy.ts';
import {assertCostBid} from '../lib/auto-bid.ts';
import {runRotation} from '../lib/rotation.ts';
const base={bid:900,min:70,max:930,target:1,rank:1,source:'MAIN',device:'PC',group:'own',observedAt:1000000,now:1000000,waitSeconds:180};
const choose=(s,extra={})=>costDecision({...base,...extra},s);
function stable(){let s;for(let i=0;i<3;i++){const d=choose(s,{now:base.now+i*180000,observedAt:base.now+i*180000});s=d.state;if(i<2)assert.equal(d.action,'hold');else return d;}}
test('three distinct stable observations start a bounded reduction',()=>{const d=stable();assert.equal(d.action,'reduce');assert.equal(d.next,810);assert.equal(choose(d.state).action,'hold');});
test('reduction waits for post-change rank then restores exact prior amount',()=>{
 const d=stable(),t=base.now+400000,s=costApplied(d.state,d.action,900,810,t);
 assert.equal(choose(s,{bid:810,rank:2,now:t+180000,observedAt:t+170000}).action,'hold');
 const restore=choose(s,{bid:810,rank:2,now:t+180000,observedAt:t+180000});assert.equal(restore.action,'restore');assert.equal(restore.next,900);
 const restored=costApplied(restore.state,restore.action,810,900,t+180000);
 assert.equal(restored.pending,undefined);assert.equal(restored.cooldownUntil,t+180000+1800000);
});
test('successful reduction continues to explore and never goes below minimum',()=>{
 const d=stable(),t=base.now+400000,s=costApplied(d.state,'reduce',900,810,t);
 const next=choose(s,{bid:810,now:t+180000,observedAt:t+180000});assert.equal(next.action,'reduce');assert.equal(next.next,730);
 const floor=choose(null,{bid:70});assert.equal(floor.action,'hold');
});
test('failed boundary uses ten-won precision after cooldown',()=>{
 const t=base.now,context=stable().state.context;
 const s={context,stable:3,lastObservation:0,changedAt:0,cooldownUntil:0,failedBid:300,goodBid:330,appliedBid:330};
 assert.equal(choose(s,{bid:330}).next,310);
 assert.equal(choose({...s,failedBid:320},{bid:330}).action,'hold');
});
test('unknown ranks and source changes cannot count toward stable reduction',()=>{
 const s=stable().state;
 assert.equal(choose(s,{rank:null,observedAt:base.now+600000,now:base.now+600000}).state.stable,0);
 const change=choose(s,{source:'MORE',observedAt:base.now+600000,now:base.now+600000});assert.equal(change.action,'hold');assert.equal(change.state.stable,1);
});
test('uncertain or externally changed amount stays blocked across source switches and restarts',()=>{
 const d=stable(),s=costApplied(d.state,'reduce',900,810,base.now);
 assert.equal(choose(JSON.parse(JSON.stringify(s)),{bid:900,source:'MORE',now:base.now+600000,observedAt:base.now+600000}).action,'hold');
});
test('outside target increases exactly ten, caps never overflow and unknown never restores',()=>{
 assert.equal(choose(null,{rank:2}).next,910);assert.equal(choose(null,{bid:930,rank:2}).action,'hold');
 const s=costApplied(stable().state,'reduce',900,810,base.now);assert.equal(choose(s,{bid:810,rank:null}).action,'hold');
});
test('write guard rejects wrong direction, source, pause, changed target and cap',()=>{
 const row={id:'kw',keyword:'test',group:'own',bid:900,target:1,min:70,max:930};
 const kw={nccKeywordId:'kw',keyword:'test',nccAdgroupId:'g',bidAmt:900,useGroupBidAmt:false,status:'ELIGIBLE',userLock:false};
 const group={nccAdgroupId:'g',name:'own',adgroupType:'WEB_SITE',status:'ELIGIBLE',userLock:false};
 const obs={status:'visible',source:'MAIN',device:'PC',rank:1,observedAt:new Date(base.now).toISOString()};
 assert.doesNotThrow(()=>assertCostBid(row,row,kw,group,900,810,obs,'PC',base.now,'reduce'));
 for(const [r,k,o,next] of [[row,kw,{...obs,source:'invalid'},810],[row,{...kw,userLock:true},obs,810],[{...row,target:2},kw,obs,810],[row,kw,obs,940],[row,kw,{...obs,rank:2},810]])assert.throws(()=>assertCostBid(r,row,k,group,900,next,o,'PC',base.now,'reduce'));
 assert.doesNotThrow(()=>assertCostBid({...row,bid:810},row,{...kw,bidAmt:810},group,810,900,{...obs,rank:2},'PC',base.now,'restore'));
});
test('managed rotation still observes all keywords before reductions or restorations',async()=>{
 const reads=[],writes=[],events=[];let now=base.now;
 const rows=[{id:'a',bid:900,target:1,max:930},{id:'b',bid:810,target:1,max:930}];
 const result=await runRotation(rows,'PC',180,{now:()=>now,stopped:async()=>false,observe:async(r,d)=>{reads.push(r.id);return {rank:1,device:d,observedAt:now};},
 manage:async(r)=>{assert.equal(reads.length,2);writes.push(r.id);return {changed:true,bid:800,status:r.id==='a'?'reduced':'restored'};},apply:async()=>{throw Error('legacy write used');},event:async(e)=>events.push(e),wait:async(s)=>{now+=s*1000;}});
 assert.equal(result.changes,2);assert.deepEqual(writes,['a','b']);assert.deepEqual(events.slice(0,2).map(e=>e.status),['reduced','restored']);
});

test('manual bid above max is skipped without attempting a reduction',()=>{
 const s=stable().state;assert.equal(choose(s,{bid:1500,observedAt:base.now+600000,now:base.now+600000}).action,'hold');
});
test('source switch still respects the last change reflection time',()=>{
 const s=costApplied(stable().state,'reduce',900,810,base.now);
 assert.equal(choose(s,{bid:810,rank:2,source:'MORE',observedAt:base.now+60000,now:base.now+60000}).action,'hold');
});

test('stable market simulation reaches 310 and only probes ten below the discovered floor',()=>{
 let s=null,bid=900,t=1000000,restores=0;
 for(let i=0;i<50;i++){
  const d=choose(s,{bid,rank:bid>=310?1:2,now:t,observedAt:t});s=d.state;
  if(d.action!=='hold'){if(d.action==='restore')restores++;s=costApplied(s,d.action,bid,d.next,t);bid=d.next;}
  t+=Math.max(180000,(s.cooldownUntil??0)-t);
 }
 assert.ok(restores>0);assert.ok([300,310].includes(bid));
 const d=choose({...s,pending:undefined,appliedBid:310,failedBid:undefined,stable:3,cooldownUntil:0,changedAt:0,fine:true},{bid:310,rank:1,now:t,observedAt:t});
 assert.equal(d.next,300);
});

test('lowest mode requires five exact-rank observations and reduces by the configured unit once',()=>{
 let s;let d;for(let i=0;i<5;i++){d=choose(s,{rank:3,target:3,stableChecks:5,exactRank:true,reductionAmount:20,now:base.now+i*180000,observedAt:base.now+i*180000});s=d.state;if(i<4)assert.equal(d.action,'hold');}
 assert.equal(d.action,'reduce');assert.equal(d.next,880);
 const mismatch=choose(s,{rank:2,target:3,stableChecks:5,exactRank:true,reductionAmount:20,now:base.now+1000000,observedAt:base.now+1000000});assert.equal(mismatch.action,'hold');assert.equal(mismatch.state.stable,0);
});
test('invalid reduction units never change bids',()=>{for(const unit of [0,15,110])assert.equal(choose(stable().state,{reductionAmount:unit}).action,'hold');});
