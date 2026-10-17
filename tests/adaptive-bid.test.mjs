import test from 'node:test';
import assert from 'node:assert/strict';
import {increaseForRank} from '../lib/adaptive-bid.ts';
import {costDecision,costApplied} from '../lib/cost-policy.ts';
import {assertCostBid} from '../lib/auto-bid.ts';
const base={bid:700,min:70,max:2000,target:3,rank:7,source:'MAIN',device:'PC',group:'g',observedAt:1000000,now:1000000,waitSeconds:180,stableChecks:2,exactRank:true,reductionAmount:10};
test('target 3: main 7+ and More add 300; main 4-6 add 50; main 1-3 hold',()=>{
 for(const rank of [7,8,15])assert.equal(increaseForRank(700,2000,3,rank,'MAIN'),1000);
 for(const rank of [1,3,30])assert.equal(increaseForRank(700,2000,3,rank,'MORE'),1000);
 for(const rank of [4,5,6])assert.equal(increaseForRank(700,2000,3,rank,'MAIN'),750);
 for(const rank of [1,2,3])assert.equal(increaseForRank(700,2000,3,rank,'MAIN'),700);
 assert.equal(increaseForRank(700,2000,1,5,'MAIN'),1000);
 assert.equal(increaseForRank(700,2000,5,8,'MAIN'),750);
});
test('remaining headroom clamps to max without rounding beyond it',()=>{
 for(const rank of [4,7])assert.equal(increaseForRank(700,730,3,rank,'MAIN'),730);
 assert.equal(increaseForRank(700,700,3,7,'MAIN'),700);
 assert.equal(increaseForRank(750,700,3,7,'MAIN'),750);
 for(const [rank,source] of [[null,'MAIN'],[0,'MAIN'],[7,null],[7,'UNKNOWN']])assert.equal(increaseForRank(700,2000,3,rank,source),700);
});
test('new rank is required after each adaptive increase and exact reduction restores before large increase',()=>{
 const first=costDecision(base);assert.equal(first.next,1000);assert.equal(first.action,'increase');
 const applied=costApplied(first.state,'increase',700,1000,base.now);
 assert.equal(costDecision({...base,bid:1000,now:1060000,observedAt:1060000},applied).action,'hold');
 assert.equal(costDecision({...base,bid:1000,rank:6,now:1180000,observedAt:1180000},applied).next,1050);
 const pending=costApplied(first.state,'reduce',700,690,base.now);
 const restore=costDecision({...base,bid:690,now:1180000,observedAt:1180000},pending);assert.equal(restore.action,'restore');assert.equal(restore.next,700);
});
test('live write guard enforces rank-dependent amount, clamps and ten-won reductions',()=>{
 const row={id:'kw',group:'g',keyword:'term',bid:700,min:70,max:2000,target:3};
 const kw={nccKeywordId:'kw',nccAdgroupId:'g1',keyword:'term',bidAmt:700,useGroupBidAmt:false,status:'ELIGIBLE'};
 const group={nccAdgroupId:'g1',name:'g',adgroupType:'WEB_SITE',status:'ELIGIBLE'};
 const o={status:'visible',source:'MAIN',rank:7,device:'PC',observedAt:new Date(base.now).toISOString()};
 const check=(next,obs=o,r=row,action='increase')=>assertCostBid(r,r,kw,group,700,next,obs,'PC',base.now,action);
 assert.doesNotThrow(()=>check(1000));assert.throws(()=>check(750));assert.throws(()=>check(1050));
 assert.doesNotThrow(()=>check(750,{...o,rank:6}));assert.throws(()=>check(1000,{...o,rank:6}));
 assert.doesNotThrow(()=>check(730,o,{...row,max:730}));
 assert.doesNotThrow(()=>check(690,{...o,rank:3},row,'reduce'));assert.throws(()=>check(680,{...o,rank:3},row,'reduce'));
 assert.throws(()=>check(1000,{...o,status:'unknown'}));
});
