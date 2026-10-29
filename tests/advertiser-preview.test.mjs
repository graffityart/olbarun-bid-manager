import test from 'node:test';
import assert from 'node:assert/strict';
import { BUSAN_REGIONS, buildPreviewPlan, normalizePreview } from '../lib/advertiser-preview.mjs';

test('10 Busan regions x two devices x keywords', () => {
  const plan = buildPreviewPlan(['부산철거', '중고컴퓨터매입']);
  assert.equal(plan.length, 40);
  assert.equal(new Set(plan.map(p => p.region.id)).size, 10);
  assert.equal(plan.filter(p => p.device === 'MOBILE').length, 20);
});
test('preview result remains unverified and read-only', () => {
  const r = normalizePreview({keyword:'부산철거',region:BUSAN_REGIONS[0],device:'PC',expectedHost:'macpro.kr',
    ads:[{url:'https://example.com/'},{url:'https://www.macpro.kr/'}],observedAt:'2026-10-29T08:00:00Z'});
  assert.equal(r.status,'unknown'); // www is not silently equated with apex
  assert.equal(r.rank,null);
  assert.equal(r.region.verified,false);
  assert.equal(r.source,'ADVERTISER_CENTER_PREVIEW');
});
test('exact hostname match and no false verification', () => {
  const r=normalizePreview({keyword:'부산철거',region:BUSAN_REGIONS[0],device:'MOBILE',expectedHost:'www.macpro.kr',
    ads:[{url:'https://www.macpro.kr/'}],observedAt:'2026-10-29T08:00:00Z'});
  assert.equal(r.rank,1);
  assert.equal(r.region.verified,false);
});
test('reject too many preview ads and unsupported regions', () => {
  const base={keyword:'x',region:BUSAN_REGIONS[0],device:'MOBILE',expectedHost:'example.com',observedAt:'2026-10-29T08:00:00Z'};
  assert.throws(()=>normalizePreview({...base,ads:Array.from({length:5},()=>({url:'https://example.com'}))}));
  assert.throws(()=>normalizePreview({...base,region:{id:'seoul'},ads:[]}));
});
