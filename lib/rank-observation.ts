import { normalizeAdHost } from './ad-sites.ts';
export type ObservedAd = { rank: number | null; adId: string | null; destination: string | null; displayUrl: string | null; title?: string | null };
// More-result pages must continue globally: page two's first result is 26,
// never the page-local title click counter (1).
export function validRankList(ads: ObservedAd[], firstRank = 1, displayOnly = false): boolean {
 return ads.length > 0 && new Set(ads.map(a => a.adId)).size === ads.length && ads.every((a,i) =>
  /^nad-[\w-]+$/.test(a.adId ?? '') && a.rank === firstRank+i && normalizeAdHost(a.displayUrl ?? '') !== null
  && (displayOnly ? a.destination === null : normalizeAdHost(a.destination ?? '') === normalizeAdHost(a.displayUrl ?? '')));
}
export function matchRank(ads: ObservedAd[], host: string) {
 const matches = ads.filter(a => normalizeAdHost(a.destination ?? a.displayUrl ?? '') === host);
 return {status: matches.length > 1 ? 'unknown' : matches.length ? 'visible' : 'not_in_observed_list',
  rank: matches.length === 1 ? matches[0].rank : null, adId: matches.length === 1 ? matches[0].adId : null};
}
export function safeMoreUrl(raw: string, keyword: string, device: string, pageIndex?: number): string | null {
 try { const u=new URL(raw); const host=device==='PC'?'ad.search.naver.com':'m.ad.search.naver.com';
  if(u.protocol!=='https:'||u.hostname!==host||u.username||u.password||u.pathname!=='/search.naver'||u.searchParams.get('query')!==keyword) return null;
  if(pageIndex!==undefined && Number(u.searchParams.get('pagingIndex')??'1')!==pageIndex) return null;
  return u.href;
 } catch {return null;}
}
