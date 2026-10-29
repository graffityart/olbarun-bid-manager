import test from 'node:test';
import assert from 'node:assert/strict';
import {tradingWindow,openingOrder,openingDecision,dailyRunState} from '../lib/trading-hours.ts';
import {runPriorityRotation} from '../lib/priority-rotation.ts';
import {costDecision} from '../lib/cost-policy.ts';
const time=s=>Date.parse(s+'+09:00');
test('Korean Monday-Saturday boundaries and exposure delay, independent of host timezone',()=>{
 for(const day of ['2026-10-26','2026-10-31']){
  assert.equal(tradingWindow(time(day+'T04:59:59')).allowed,false);
  const five=tradingWindow(time(day+'T05:00:00'));assert.equal(five.waitingForExposure,true);assert.equal(five.nextStart,time(day+'T05:30:00'));
  assert.equal(tradingWindow(time(day+'T05:29:59')).allowed,false);
  assert.equal(tradingWindow(time(day+'T05:30:00')).allowed,true);
  assert.equal(tradingWindow(time(day+'T19:59:59')).allowed,true);
  assert.equal(tradingWindow(time(day+'T20:00:00')).allowed,false);
 }
 assert.equal(tradingWindow(time('2026-11-01T12:00:00')).allowed,false);
 assert.equal(tradingWindow(time('2026-10-31T20:00:00')).nextStart,time('2026-11-02T05:30:00'));
 assert.equal(tradingWindow(time('2026-10-30T20:00:00')).nextStart,time('2026-10-31T05:30:00'));
 assert.equal(tradingWindow(time('2026-11-01T00:00:00')).dayKey,'2026-11-01');
});
test('opening order prioritizes confirmed outside and More, then unobserved, then goals',()=>{
 const rows=['goal','unknown','more','far'].map(id=>({id,target:3}));
 assert.deepEqual(openingOrder(rows,[{id:'goal',status:'visible',rank:1,source:'MAIN'},{id:'more',status:'visible',rank:1,source:'MORE'},{id:'far',status:'visible',rank:7,source:'MAIN'}]),['more','far','unknown','goal']);
});
test('first two rounds defer reductions and reset stable checks; third uses original rules',()=>{
 const decision={action:'reduce',next:690,state:{stable:2},reason:'reduce'};
 for(const round of [1,2]){const d=openingDecision(decision,700,round);assert.equal(d.action,'hold');assert.equal(d.next,700);assert.equal(d.state.stable,0);}
 assert.equal(openingDecision(decision,700,3).action,'reduce');
 for(const action of ['increase','restore'])assert.equal(openingDecision({...decision,action},700,1).action,action);
 const unknown={...decision,action:'hold',reason:'순위 미확인'};assert.equal(openingDecision(unknown,700,1).reason,'순위 미확인');
});
test('same-day manual restart retains completed rounds, next day resets, partial resume keeps its round',()=>{
 assert.deepEqual(dailyRunState('2026-10-29',2,{},null),{cycle:2,resume:null});
 const cp={phase:'manage'};assert.deepEqual(dailyRunState('2026-10-29',1,{runDate:'2026-10-29',cycle:2},cp),{cycle:2,resume:cp});
 assert.deepEqual(dailyRunState('2026-10-30',0,{runDate:'2026-10-29',cycle:8},cp),{cycle:0,resume:null});
 assert.deepEqual(dailyRunState('2026-10-29',1,{runDate:'2026-10-29',cycle:2},{phase:'complete'}),{cycle:2,resume:null});
});
test('opening single pass manages each keyword once, then normal scheduling can repeat urgent work',async()=>{
 const rows=['a','b','c','d'].map(id=>({id,bid:700,max:3000,target:3}));let now=1000000,saved;const visits=[];
 const ports={singlePass:true,order:['c','a','b','d'],now:()=>now,stopped:async()=>false,wait:async s=>{now+=s*1000;},checkpoint:async cp=>{saved=cp;},observe:async r=>({rank:9,source:'MAIN',device:'PC',observedAt:now}),manage:async r=>{visits.push(r.id);now+=200000;return {changed:true,status:'increased',bid:1000};},apply:async()=>{},event:async()=>{}};
 await runPriorityRotation(rows,'PC',180,ports);assert.deepEqual(visits,['c','a','b','d']);assert.equal(saved.singlePass,true);
});
test('20:00 stops before a query result can cause a write; next business day is allowed',async()=>{
 const row={id:'a',bid:700,max:3000,target:3};let now=time('2026-10-29T19:59:59'),writes=0;
 const ports={now:()=>now,stopped:async()=>!tradingWindow(now).allowed,wait:async s=>{now+=s*1000;},observe:async()=>{now=time('2026-10-29T20:00:00');return {rank:9,source:'MAIN',device:'PC',observedAt:now};},manage:async()=>{writes++;return {changed:true,status:'increased',bid:1000};},apply:async()=>{},event:async()=>{}};
 assert.equal((await runPriorityRotation([row],'PC',180,ports)).stopped,true);assert.equal(writes,0);
});
test('opening passes allow fresh outside increases, but never count inside ranks toward later reduction',()=>{
 const input={bid:700,min:70,max:3000,target:3,rank:7,source:'MAIN',device:'PC',group:'g',observedAt:1000000,now:1000000,waitSeconds:180,stableChecks:2,exactRank:true,reductionAmount:10};
 assert.equal(openingDecision(costDecision(input),700,1).next,1000);
 const d=openingDecision(costDecision({...input,rank:3}),700,2);assert.equal(d.action,'hold');assert.equal(d.state.stable,0);
});

test('opening pass resumes its saved order and does not repeat completed keywords',async()=>{
 const rows=['a','b','c'].map(id=>({id,bid:700,max:3000,target:3}));let stop=false,saved;const seen=[];let pause=true;
 const ports={singlePass:true,order:['c','b','a'],now:()=>1000000,stopped:async()=>stop,wait:async()=>{},checkpoint:async cp=>{saved=cp;if(pause&&cp.nextManage===1)stop=true;},observe:async r=>({rank:8,source:'MAIN',device:'PC',observedAt:1000000}),manage:async r=>{seen.push(r.id);return {changed:true,status:'increased',bid:1000};},apply:async()=>{},event:async()=>{}};
 await runPriorityRotation(rows,'PC',180,ports);assert.deepEqual(seen,['c']);pause=false;stop=false;ports.resume=saved;await runPriorityRotation(rows,'PC',180,ports);assert.deepEqual(seen,['c','b','a']);
});
