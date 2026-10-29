import test from 'node:test';
import assert from 'node:assert/strict';
import { regionalRankVerified, unverifiedRegionalObservation } from '../lib/regional-rank.ts';
const now = Date.parse('2026-10-29T07:00:00.000Z');
const base = {keyword:'부산철거',expectedHost:'example.com',device:'PC',status:'visible',rank:3,observedAt:new Date(now).toISOString(),
  region:{code:'KR-26',verified:true,verificationMethod:'independent-provider',providerId:'test-provider',evidenceId:'test-evidence'}};
const opts={keyword:'부산철거',host:'example.com',device:'PC',now};
test('unverified VPS observation cannot authorize a bid',()=>{
  assert.equal(regionalRankVerified(unverifiedRegionalObservation(base),opts),false);
});
test('attested Busan rank requires exact keyword, host and device',()=>{
  assert.equal(regionalRankVerified(base,opts),true);
  for(const change of [{device:'MOBILE'},{keyword:'서울철거'},{expectedHost:'other.com'},{region:{...base.region,code:'KR-11'}},{region:{...base.region,evidenceId:''}}]){
    assert.equal(regionalRankVerified({...base,...change},opts),false);
  }
});
test('stale, future, non-visible or malformed ranks cannot authorize a bid',()=>{
  for(const change of [{observedAt:new Date(now-61000).toISOString()},{observedAt:new Date(now+6000).toISOString()},{status:'unknown'},{rank:null},{rank:0}]){
    assert.equal(regionalRankVerified({...base,...change},opts),false);
  }
});
