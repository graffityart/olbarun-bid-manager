// Read-only experiment for Naver advertiser-center regional exposure previews.
// This module does NOT log in, scrape, attest provenance, or authorize bid writes.
export const BUSAN_REGIONS = Object.freeze([
  { id: 'busanjin-bujeon', city: '부산광역시', district: '부산진구', neighborhood: '부전동' },
  { id: 'busanjin-jeonpo', city: '부산광역시', district: '부산진구', neighborhood: '전포동' },
  { id: 'haeundae-udong', city: '부산광역시', district: '해운대구', neighborhood: '우동' },
  { id: 'suyeong-gwangan', city: '부산광역시', district: '수영구', neighborhood: '광안동' },
  { id: 'dongnae-oncheon', city: '부산광역시', district: '동래구', neighborhood: '온천동' },
  { id: 'sasang-gwaebeop', city: '부산광역시', district: '사상구', neighborhood: '괘법동' },
  { id: 'jung-nampo', city: '부산광역시', district: '중구', neighborhood: '남포동' },
  { id: 'saha-hadan', city: '부산광역시', district: '사하구', neighborhood: '하단동' },
  { id: 'buk-deokcheon', city: '부산광역시', district: '북구', neighborhood: '덕천동' },
  { id: 'gangseo-myeongji', city: '부산광역시', district: '강서구', neighborhood: '명지동' },
]);
export const DEVICES = Object.freeze(['PC', 'MOBILE']);
export function buildPreviewPlan(keywords, regions = BUSAN_REGIONS) {
  if (!Array.isArray(keywords) || !keywords.length || keywords.length > 20) throw Error('Invalid keyword sample');
  if (!Array.isArray(regions) || !regions.length || regions.length > 10) throw Error('Invalid region sample');
  if (new Set(regions.map(r => r.id)).size !== regions.length) throw Error('Duplicate region');
  if (keywords.some(k => typeof k !== 'string' || !k.trim())) throw Error('Invalid keyword');
  return keywords.flatMap(keyword => regions.flatMap(region => DEVICES.map(device => ({
    keyword, region, device, source: 'advertiser-center-preview', mode: 'read-only',
  }))));
}
// Preview positions are not independently verified regional search ranks.
// Never set region.verified=true or verificationMethod='independent-provider' here.
export function normalizePreview({ keyword, region, device, expectedHost, ads, observedAt }) {
  if (!BUSAN_REGIONS.some(r => r.id === region?.id)) throw Error('Unsupported region');
  if (!DEVICES.includes(device) || !keyword?.trim() || !expectedHost?.trim()) throw Error('Invalid identity');
  if (!Array.isArray(ads) || ads.length > (device === 'PC' ? 10 : 4)) throw Error('Invalid preview ads');
  const host = new URL(expectedHost.includes('://') ? expectedHost : 'https://' + expectedHost).hostname.toLowerCase();
  const matches = ads.map((ad, index) => {
    if (typeof ad?.url !== 'string') throw Error('Invalid ad URL');
    let observedHost;
    try { observedHost = new URL(ad.url).hostname.toLowerCase(); } catch { throw Error('Invalid ad URL'); }
    return observedHost === host ? index + 1 : null;
  }).filter(Boolean);
  if (matches.length > 1) throw Error('Ambiguous host match');
  const time = Date.parse(observedAt);
  if (!Number.isFinite(time)) throw Error('Invalid observation time');
  return {
    keyword, device, expectedHost: host, status: matches.length ? 'visible' : 'unknown',
    rank: matches[0] ?? null, observedAt: new Date(time).toISOString(),
    source: 'ADVERTISER_CENTER_PREVIEW', previewRegion: { ...region },
    region: { code: 'KR-26', verified: false, verificationMethod: 'none',
      providerId: null, evidenceId: null, reason: 'Advertiser-center preview is not independently attested rank evidence' },
  };
}
