import test from 'node:test';
import assert from 'node:assert/strict';
import {costDecision,costApplied} from '../lib/cost-policy.ts';
import {assertCostBid} from '../lib/auto-bid.ts';
const base={bid:900,min:70,max:1000,target:3,rank:3,source:'MAIN',device:'PC',group:'own',observedAt:1000000,now:1000000,waitSeconds:180};
const choose=(s,extra={})=>costDecision({...base,...extra},s);
test('two distinct post-wait observations reduce exactly ten won',()=>{
 const first=choose();assert.equal(first.action,'hold');assert.equal(first.state.stable,1);
 assert.equal(choose(first.state).action,'hold');
 const second=choose(first.state,{now:1180000,observedAt:1180000});assert.equal(second.action,'reduce');assert.equal(second.next,890);
 const applied=costApplied(second.state,'reduce',900,890,1180000);
 assert.equal(choose(applied,{bid:890,now:1300000,observedAt:1300000}).action,'hold');
 const verify=choose(applied,{bid:890,now:1360000,observedAt:1360000});assert.equal(verify.action,'hold');assert.equal(verify.state.stable,1);
 assert.equal(choose(verify.state,{bid:890,now:1540000,observedAt:1540000}).next,880);
});
test('outside target including More increases fifty and never exceeds max',()=>{
 for(const extra of [{rank:4},{source:'MORE',rank:1}]){const d=choose(null,extra);assert.equal(d.action,'increase');assert.equal(d.next,950);}
 for(const bid of [960,1000,1010])assert.equal(choose(null,{bid,rank:4}).action,'hold');
 assert.equal(choose(null,{bid:950,rank:4}).next,1000);
});
test('unknown stale wrong timing and externally changed bids never change',()=>{
 for(const extra of [{rank:null},{observedAt:1},{observedAt:1000001},{bid:60}])assert.equal(choose(null,extra).action,'hold');
 const d=choose();const s=costApplied(d.state,'reduce',900,890,1000000);
 assert.equal(choose(s,{bid:900,source:'MORE',rank:4,now:1360000,observedAt:1360000}).action,'hold');
});
test('failed ten-won reduction restores previous amount and cools down',()=>{
 const s=costApplied(choose().state,'reduce',900,890,1000000);
 const d=choose(s,{bid:890,rank:4,now:1180000,observedAt:1180000});assert.equal(d.action,'restore');assert.equal(d.next,900);
 const restored=costApplied(d.state,'restore',890,900,1180000);
 assert.equal(restored.cooldownUntil,2980000);
});
test('minimum floor and exact target are respected',()=>{
 const first=choose(null,{bid:70});assert.equal(choose(first.state,{bid:70,now:1180000,observedAt:1180000}).action,'hold');
 const d=choose(null,{exactRank:true,rank:2});assert.equal(d.action,'hold');assert.equal(d.state.stable,0);
});
test('write guard accepts fifty but rejects ten-won increases and cap breaches',()=>{
 const row={id:'kw',keyword:'test',group:'own',bid:900,target:3,min:70,max:1000};
 const kw={nccKeywordId:'kw',keyword:'test',nccAdgroupId:'g',bidAmt:900,useGroupBidAmt:false,status:'ELIGIBLE',userLock:false};
 const group={nccAdgroupId:'g',name:'own',adgroupType:'WEB_SITE',status:'ELIGIBLE',userLock:false};
 const obs={status:'visible',source:'MAIN',device:'PC',rank:4,observedAt:new Date(base.now).toISOString()};
 const check=(next,o=obs,r=row,k=kw)=>assertCostBid(r,row,k,group,900,next,o,'PC',base.now,'increase');
 assert.doesNotThrow(()=>check(950));for(const next of [910,1000,1050])assert.throws(()=>check(next));
 assert.throws(()=>check(950,{...obs,rank:3}));assert.throws(()=>check(950,obs,row,{...kw,userLock:true}));
 assert.throws(()=>check(950,obs,{...row,max:940}));
});

test('policy update preserves an in-flight reduction for exact restoration',()=>{
 const previous={context:'old-five-check-policy',stable:4,lastObservation:0,changedAt:1000000,appliedBid:880,pending:{before:900,after:880},cooldownUntil:0};
 const d=choose(previous,{bid:880,rank:4,now:1180000,observedAt:1180000});assert.equal(d.action,'restore');assert.equal(d.next,900);
});
