import { chromium, devices } from 'playwright';
import { normalizeAdHost } from '../lib/ad-sites.ts';

const [keyword, rawHost, device = 'PC'] = process.argv.slice(2);
const expectedHost = rawHost && normalizeAdHost(rawHost);
if (!keyword?.trim() || !expectedHost || !['PC', 'MOBILE'].includes(device)) {
  console.error('Usage: node scripts/rank-check.mjs "keyword" domain PC|MOBILE');
  process.exit(1);
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(device === 'MOBILE'
    ? { ...devices['iPhone 13'], locale: 'ko-KR' }
    : { locale: 'ko-KR', viewport: { width: 1365, height: 900 } });
  const url = new URL(device === 'MOBILE'
    ? 'https://m.search.naver.com/search.naver' : 'https://search.naver.com/search.naver');
  url.searchParams.set('query', keyword);
  const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (response?.status() !== 200) throw Error(`Search HTTP ${response?.status()}`);
  const selector = device === 'PC' ? '#power_link_body > ul.lst_type > li.lst a.lnk_head'
    : 'a.txt_link[onclick*="a=pwl.tit&"]';
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 15000 });
  const ads = await page.locator(selector).evaluateAll((links, isMobile) => links
    .filter(link => link.getClientRects().length > 0)
    .map(link => {
      const info = link.getAttribute('onclick') || '';
      return {
        rank: Number(info.match(/&r=(\d+)/)?.[1]) || null,
        adId: info.match(/&i=(nad-[\w-]+)/)?.[1] ?? null,
        destination: info.match(/(?:urlencode|encodeURIComponent)\("([^"\\]+)"\)/)?.[1] ?? null,
        displayUrl: (isMobile ? link.querySelector('.url')
          : link.closest('li.lst')?.querySelector('a.lnk_url'))?.textContent?.trim() ?? null,
        title: (isMobile ? link.querySelector('.tit_area') : link)?.textContent?.trim() ?? null,
      };
    }), device === 'MOBILE');
  // Require a complete, contiguous list. Changed markup or additional sections
  // must not silently become a valid rank observation.
  const valid = ads.length > 0 && new Set(ads.map(a => a.adId)).size === ads.length
    && ads.every((ad, index) => ad.adId && ad.rank === index + 1 && ad.destination
      && ad.displayUrl && normalizeAdHost(ad.destination) === normalizeAdHost(ad.displayUrl));
  const matches = valid ? ads.filter(ad => normalizeAdHost(ad.destination) === expectedHost) : [];
  const status = !valid || matches.length > 1 ? 'unknown'
    : matches.length === 1 ? 'visible' : 'not_in_observed_list';
  console.log(JSON.stringify({ keyword, expectedHost, device, observedAt: new Date().toISOString(),
    status, rank: status === 'visible' ? matches[0].rank : null,
    observedCount: ads.length, ads,
    note: 'Read-only observation from this VPS. No ad clicks or bid changes.' }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ keyword, expectedHost, device, status: 'unknown', rank: null,
    error: error.message }, null, 2));
  process.exitCode = 1;
} finally { await browser.close(); }
