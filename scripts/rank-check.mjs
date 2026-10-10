import { chromium, devices } from 'playwright';
import { normalizeAdHost } from '../lib/ad-sites.ts';
import { validRankList, matchRank, safeMoreUrl } from '../lib/rank-observation.ts';

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
  const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
  if (response?.status() !== 200) throw Error(`Search HTTP ${response?.status()}`);
  const selector = device === 'PC' ? '#power_link_body > ul.lst_type > li.lst a.lnk_head'
    : 'a.txt_link[onclick*="a=pwl.tit&"]';
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 5000 });
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
  const valid = validRankList(ads);
  let result = valid ? matchRank(ads, expectedHost) : { status: 'unknown', rank: null, adId: null };
  const mainRank = result.rank;
  let source = result.status === 'visible' ? 'MAIN' : null;
  let moreRank = null, moreObservedCount = 0, morePages = 0, moreStatus = null;
  let observedAds = ads;
  // Use the mobile search page's actual More link; never use PC results as mobile ranks.
  const moreLinks = await page.locator('a[href]').evaluateAll(links => links
    .filter(a => a.getClientRects().length && ['ad.search.naver.com','m.ad.search.naver.com'].includes(new URL(a.href).hostname))
    .map(a => a.href));
  let moreUrl = moreLinks.map(u => safeMoreUrl(u, keyword, device, 1)).find(Boolean);
  if (!moreUrl && device === 'PC') {
    const u = new URL('https://ad.search.naver.com/search.naver');
    u.searchParams.set('query', keyword); moreUrl = u.href;
  }
  const deadline = Date.now() + 45000;
  if (valid && result.status === 'not_in_observed_list' && moreUrl) {
    const collected = [];
    try {
      for (let pageIndex = 1; pageIndex <= 4; pageIndex++) {
        const remaining = deadline-Date.now();
        if (remaining < 1000) throw Error('More observation time limit');
        const moreResponse = await page.goto(moreUrl, {waitUntil:'domcontentloaded',timeout:Math.min(15000,remaining)});
        if (moreResponse?.status() !== 200 || !safeMoreUrl(page.url(),keyword,device,pageIndex)) throw Error('More page identity changed');
        const moreSelector = device === 'PC' ? '.ad_section.section > ol.lst_type > li.lst' : 'a.txt_link[onclick*="sct.title"]';
        await page.locator(moreSelector).first().waitFor({state:'visible',timeout:Math.min(5000,Math.max(1,deadline-Date.now()))});
        const batch = await page.locator(moreSelector).evaluateAll((items, mobile) => items.filter(el=>el.getClientRects().length).map(el=>{
          const link = mobile ? el : el.querySelector('a.favicon_wrap');
          const title = mobile ? el : el.querySelector('a.tit_wrap');
          const info = link?.getAttribute('onclick') ?? '';
          const nclk = mobile ? info.match(/'sct\.title',\s*'(nad-[\w-]+)',\s*(\d+)\)/) : null;
          return {rank:mobile?Number(nclk?.[2])||null:Number(info.match(/&r=(\d+)/)?.[1])||null,
            adId:mobile?nclk?.[1]??null:info.match(/&i=(nad-[\w-]+)/)?.[1]??null,
            destination:mobile?null:info.match(/(?:urlencode|encodeURIComponent)\("([^"\\]+)"\)/)?.[1]??null,
            displayUrl:(mobile?el.querySelector('.url_link'):el.querySelector('a.url'))?.textContent?.trim()??null,
            title:(mobile?el.querySelector('.tit_area'):title)?.textContent?.trim()??null};
        }),device==='MOBILE');
        if (!validRankList(batch,collected.length+1,device==='MOBILE')) throw Error('More rank metadata invalid');
        collected.push(...batch);
        if (!validRankList(collected,1,device==='MOBILE')) throw Error('Duplicate more ad IDs');
        morePages=pageIndex; moreObservedCount=collected.length;
        const found = matchRank(collected,expectedHost); moreStatus=found.status;
        if (found.status==='unknown') throw Error('Multiple matching ads');
        if (found.status==='visible') {result=found;source='MORE';moreRank=found.rank;observedAds=collected;break;}
        const nextLinks = device==='PC' ? await page.locator('a.next[href]').evaluateAll(links=>links.filter(a=>a.getClientRects().length).map(a=>a.href)) : [];
        const next = nextLinks.map(u=>safeMoreUrl(u,keyword,device,pageIndex+1)).find(Boolean);
        if (!next) break;
        if (pageIndex===4) {moreStatus='limit_reached';break;}
        moreUrl=next;
      }
    } catch { moreStatus='unknown'; result={status:'unknown',rank:null,adId:null}; source=null; }
  }
  console.log(JSON.stringify({keyword,expectedHost,device,observedAt:new Date().toISOString(),...result,
    source,mainRank,moreRank,mainObservedCount:ads.length,moreObservedCount,morePages,moreStatus,
    observedCount:source==='MORE'?moreObservedCount:ads.length,ads:observedAds,
    note:'Read-only observation from this VPS. More ranks are separate from main search ranks. No ad clicks or bid changes.'},null,2));
} catch (error) {
  console.log(JSON.stringify({ keyword, expectedHost, device, status: 'unknown', rank: null,
    error: error.message }, null, 2));
  process.exitCode = 1;
} finally { await browser.close(); }
