import test from 'node:test';
import assert from 'node:assert/strict';
import {searchAccessDenied,SearchAccessDenied} from '../lib/search-access.ts';
import {runRotation} from '../lib/rotation.ts';
test('only structured search access denial triggers the breaker',()=>{
 assert.equal(searchAccessDenied(JSON.stringify({error:'Search HTTP 403'})),true);
 assert.equal(searchAccessDenied(JSON.stringify({error:'Search HTTP 500'})),false);
 assert.equal(searchAccessDenied('Search HTTP 403'),false);
});
test('access denial aborts collection before any bidding or subsequent keyword',async()=>{
 let reads=0,writes=0;
 await assert.rejects(runRotation(['a','b'].map(id=>({id,bid:90,target:3,max:200})),'MOBILE',180,{
 now:()=>1000,stopped:async()=>false,observe:async()=>{reads++;throw new SearchAccessDenied()},apply:async()=>{writes++},event:async()=>{},wait:async()=>{}
 }),{name:'SearchAccessDenied'});
 assert.equal(reads,1);assert.equal(writes,0);
});
