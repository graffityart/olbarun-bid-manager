import test from 'node:test';
import assert from 'node:assert/strict';
import {compareSearchEnvironments} from '../lib/search-environment-compare.ts';
const manual={keyword:'화명동프랜차이즈철거',expectedHost:'lastwar.co.kr',device:'MOBILE',rank:2};
const vps={keyword:manual.keyword,expectedHost:manual.expectedHost,device:'MOBILE',status:'not_in_observed_list',rank:null};
test('visible manual rank versus VPS absence flags mismatch without authorizing bids',()=>{
 const r=compareSearchEnvironments({manual,vps});
 assert.equal(r.status,'SEARCH_ENVIRONMENT_MISMATCH');
 assert.equal(r.manualRank,2);
 assert.equal(r.vpsRank,null);
 assert.equal(r.bidWriteAllowed,false);
 assert.equal(r.regionVerified,false);
});
test('even matching ranks do not attest region or permit writes',()=>{
 const r=compareSearchEnvironments({manual,vps:{...vps,status:'visible',rank:2}});
 assert.equal(r.status,'RANKS_AGREE_UNVERIFIED');
 assert.equal(r.bidWriteAllowed,false);
});
test('reject mismatched identity and inconclusive search',()=>{
 for(const x of [{...vps,device:'PC'},{...vps,expectedHost:'other.kr'},{...vps,status:'unknown'}])
 assert.throws(()=>compareSearchEnvironments({manual,vps:x}));
});
