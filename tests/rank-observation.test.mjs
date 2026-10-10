import test from 'node:test';
import assert from 'node:assert/strict';
import {validRankList,matchRank,safeMoreUrl} from '../lib/rank-observation.ts';
import {runRotation} from '../lib/rotation.ts';
const ad=(rank,host='example.com')=>({rank,adId:`nad-test-${rank}`,destination:`https://${host}`,displayUrl:host});
test('more rank 18 is retained and produces one ten-won increase',async()=>{
 const ads=Array.from({length:25},(_,i)=>ad(i+1,i===17?'lastwar.co.kr':'example.com'));
 assert.equal(validRankList(ads),true);
 const observation=matchRank(ads,'lastwar.co.kr');assert.equal(observation.rank,18);
 const writes=[];let now=100000;
 const result=await runRotation([{id:'own',bid:90,target:3,max:930}],'PC',180,{now:()=>now,stopped:async()=>false,
 observe:async()=>({...observation,device:'PC',observedAt:now}),apply:async(...args)=>{writes.push(args);},event:async()=>{},wait:async(s)=>{now+=s*1000;}});
 assert.equal(result.changes,1);assert.deepEqual(writes,[['own',90,100]]);
});
test('page two requires global 26 instead of a reset local rank 1',()=>{
 const page=Array.from({length:10},(_,i)=>ad(i+26));
 assert.equal(validRankList(page,26),true);
 assert.equal(validRankList(page.map((a,i)=>({...a,rank:i+1})),26),false);
 assert.equal(validRankList([...Array.from({length:25},(_,i)=>ad(i+1)),...page]),true);
});
test('duplicate IDs, rank gaps and deceptive display hosts are rejected',()=>{
 assert.equal(validRankList([ad(1),{...ad(2),adId:ad(1).adId}]),false);
 assert.equal(validRankList([ad(1),ad(3)]),false);
 assert.equal(validRankList([{...ad(1),displayUrl:'lastwar.co.kr'}]),false);
 assert.equal(matchRank([ad(1,'lastwar.co.kr.evil.test')],'lastwar.co.kr').rank,null);
 assert.equal(matchRank([ad(1,'lastwar.co.kr'),ad(2,'lastwar.co.kr')],'lastwar.co.kr').status,'unknown');
});
test('mobile display-only metadata is explicit and cannot masquerade as main destination data',()=>{
 const ads=[{...ad(1,'lastwar.co.kr'),destination:null}];
 assert.equal(validRankList(ads),false);assert.equal(validRankList(ads,1,true),true);
});
test('more navigation stays on the same keyword, device and next page',()=>{
 const pc='https://ad.search.naver.com/search.naver?query=test&pagingIndex=2';
 assert.equal(safeMoreUrl(pc,'test','PC',2),pc);
 assert.equal(safeMoreUrl(pc,'test','MOBILE',2),null);
 assert.equal(safeMoreUrl(pc,'other','PC',2),null);
 assert.equal(safeMoreUrl(pc,'test','PC',3),null);
 assert.equal(safeMoreUrl('https://ader.naver.com/search.naver?query=test','test','PC'),null);
 assert.equal(safeMoreUrl('https://m.ad.search.naver.com/search.naver?query=test&where=m_expd','test','MOBILE',1)?.includes('m.ad.search'),true);
});
