import test from 'node:test';
import assert from 'node:assert/strict';
import {siteForGroup, matchesAdSite} from '../lib/ad-sites.ts';

test('advertising domains match exactly and unknown groups stay unconfigured', () => {
  assert.equal(siteForGroup('파워링크#1_광고그룹#1'), 'lastwar.co.kr');
  assert.equal(siteForGroup('고장난폐노트북_전국택배'), 'macpro.kr');
  assert.equal(siteForGroup('새 광고그룹'), null);
  assert.equal(matchesAdSite('https://WWW.lastwar.co.kr/contact', 'lastwar.co.kr'), true);
  assert.equal(matchesAdSite('https://macpro.kr/buy', 'www.macpro.kr'), true);
  for (const url of ['https://lastwar.co.kr.evil.test', 'https://evil.test/lastwar.co.kr', 'https://lastwar.co.kr@evil.test', 'javascript:alert(1)', 'https://ad.naver.com/?url=lastwar.co.kr']) {
    assert.equal(matchesAdSite(url, 'lastwar.co.kr'), false);
  }
});
