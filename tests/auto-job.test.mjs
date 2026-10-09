import test from 'node:test';
import assert from 'node:assert/strict';
import {makeAutoJob} from '../lib/auto-job.ts';
import {assertAutoBid} from '../lib/auto-bid.ts';
const row={id:'a',keyword:'부산철거',group:'파워링크#1_광고그룹#1',bid:90,max:100,target:4};
const state={mode:'live',device:'PC',rows:[row]};
test('queue uses saved keywords and rejects demo, wrong device, duplicates and unconfigured groups',()=>{
 assert.deepEqual(makeAutoJob(state,['a'],'PC',180,'job').ids,['a']);
 for(const args of [[{...state,mode:'demo'},['a'],'PC',180],[state,['a'],'MOBILE',180],[state,['a','a'],'PC',180],[state,['missing'],'PC',180],[state,['a'],'PC',119],[{...state,rows:[{...row,group:'unknown'}]},['a'],'PC',180]])assert.throws(()=>makeAutoJob(...args,'job'));
});
const kw={nccKeywordId:'a',keyword:row.keyword,nccAdgroupId:'g',bidAmt:70,useGroupBidAmt:true,status:'ELIGIBLE',userLock:false};
const group={nccAdgroupId:'g',name:row.group,adgroupType:'WEB_SITE',bidAmt:90,status:'ELIGIBLE',userLock:false};
const now=Date.now(),observation={status:'visible',device:'PC',rank:8,observedAt:new Date(now).toISOString()};
const check=(r=row,k=kw,g=group,o=observation,next=100)=>assertAutoBid(r,row,k,g,90,next,o,'PC',now);
test('effective group bid is checked rather than unused keyword bid',()=>{check();assert.throws(()=>check(row,kw,{...group,bidAmt:100}),/saved=90, actual=100/);check(row,{...kw,useGroupBidAmt:false,bidAmt:90});});
test('no write with stale, absent, wrong-device, target rank, paused ads, changed settings or cap',()=>{
 for(const o of [{...observation,status:'not_in_observed_list',rank:null},{...observation,rank:4},{...observation,device:'MOBILE'},{...observation,observedAt:new Date(now-60001).toISOString()}])assert.throws(()=>check(row,kw,group,o));
 assert.throws(()=>check({...row,max:90}));assert.throws(()=>check({...row,target:3}));assert.throws(()=>check(row,{...kw,userLock:true}));assert.throws(()=>check(row,kw,{...group,status:'PAUSED'}));assert.throws(()=>check(row,kw,group,observation,110));
});
