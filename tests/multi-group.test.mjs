import test from 'node:test';
import assert from 'node:assert/strict';
import {groupKey,groupRows,assertGroupSelection,autoJobKey} from '../lib/group-scope.ts';
import {serialWork,searchDelay,jobsOverlap} from '../lib/shared-work.ts';
import {runRotation} from '../lib/rotation.ts';
import {siteForRow} from '../lib/ad-sites.ts';
import {assertAutoBid} from '../lib/auto-bid.ts';
test('identically named groups in separate campaigns are isolated by Naver ID',()=>{
 const rows=[{id:'a',group:'same',groupId:'g1'},{id:'b',group:'same',groupId:'g2'}];
 assert.equal(groupKey(rows[0]),'g1');assert.deepEqual(groupRows(rows,'g2').map(r=>r.id),['b']);
 assert.throws(()=>assertGroupSelection(rows,['a','b'],'g1'));
 assert.notEqual(autoJobKey('g1'),autoJobKey('g2'));
 assert.equal(jobsOverlap({ids:['a']},{ids:['b']}),false);assert.equal(jobsOverlap({ids:['a']},{ids:['a']}),true);
});
test('FIFO shared queue does not overlap browsers or strand other groups after failure',async()=>{
 const work=serialWork(),events=[];let concurrent=0,peak=0;
 const tasks=['demolition','purchase','estate'].map(group=>work(async()=>{concurrent++;peak=Math.max(peak,concurrent);events.push(group);await Promise.resolve();concurrent--;if(group==='purchase')throw Error('one group failed');return group;}));
 const results=await Promise.allSettled(tasks);assert.equal(peak,1);assert.deepEqual(events,['demolition','purchase','estate']);assert.equal(results[2].status,'fulfilled');
 assert.equal(searchDelay(10000,20000),5000);assert.equal(searchDelay(10000,26000),0);
});
test('two group rotations keep full-scan-before-write and stop independently',async()=>{
 const work=serialWork(),events=[];let stopA=false;const now=100000;
 async function group(name,device){const rows=[1,2].map(i=>({id:name+i,bid:70,target:3,max:100}));return runRotation(rows,device,180,{now:()=>now,deferReflectionWait:true,stopped:async()=>name==='A'&&stopA,wait:async()=>{},event:async()=>{},observe:row=>work(async()=>{events.push('query:'+row.id);if(row.id==='A2')stopA=true;return {rank:8,device,observedAt:now};}),apply:async()=>{throw Error('legacy write must not run')},manage:row=>work(async()=>{events.push('write:'+row.id);return {changed:true,status:'increased',bid:80};})});}
 const [a,b]=await Promise.all([group('A','PC'),group('B','MOBILE')]);assert.equal(a.stopped,true);assert.equal(b.changes,2);assert.ok(!events.some(e=>e.startsWith('write:A')));assert.ok(events.indexOf('query:B2')<events.indexOf('write:B1'));
});
test('explicit per-group host overrides legacy names and unknown hosts stay blocked',()=>{
 assert.equal(siteForRow({group:'unknown',siteHost:'https://www.macpro.kr'}),'macpro.kr');
 assert.equal(siteForRow({group:'파워링크#1_광고그룹#1',siteHost:null}),null);
});
test('Naver group ID must match even when the group name is identical',()=>{
 const row={id:'a',group:'same',groupId:'expected',keyword:'term',bid:70,target:3,max:100};
 assert.throws(()=>assertAutoBid(row,row,{nccKeywordId:'a',keyword:'term',nccAdgroupId:'wrong',bidAmt:70},{nccAdgroupId:'wrong',name:'same',adgroupType:'WEB_SITE'},70,80,{status:'visible',device:'PC',rank:8,observedAt:new Date(100000).toISOString()},'PC',100000),/identity/);
});
