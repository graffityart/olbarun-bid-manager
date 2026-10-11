import { chromium, devices } from 'playwright';
import { normalizeAdHost } from '../lib/ad-sites.ts';
import { mobileMoreBatch,validRankList, matchRank, safeMoreUrl } from '../lib/rank-observation.ts';

const [keyword, rawHost, device = 'PC'] = process.argv.slice(2);
const expectedHost = rawHost && normalizeAdHost(rawHost);
if (!keyword?.trim() || !expectedHost || !['PC', 'MOBILE'].includes(device)) {
  console.error('Usage: node scripts/rank-check.mjs "keyword" domain PC|MOBILE');
  process.exit(1);
}
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(device === 'MOBILE'
    ? { ...devices['iPhone 13'], locale: 'ko-KR' }
    : { locale: 'ko-KR', viewport: { width: 1365, height: 900 } });
  let page = await context.newPage();
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
  let moreError = null;
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
    // Match the standalone successful mobile test: a fresh tab in the same context.
    if(device==='MOBILE'){const mainPage=page;page=await mainPage.context().newPage();await mainPage.close();}

    const collected = [];
    let appended = false;
    try {
      for (let pageIndex = 1; pageIndex <= 4; pageIndex++) {
        const remaining = deadline-Date.now();
        if (remaining < 1000) throw Error('More observation time limit');
        const moreResponse = appended ? null : await page.goto(moreUrl, {waitUntil:'domcontentloaded',timeout:Math.min(15000,remaining)});
        if(moreResponse?.status()===403)throw Error('Search HTTP 403');
        if ((!appended && moreResponse?.status() !== 200) || !safeMoreUrl(page.url(),keyword,device,appended?1:pageIndex)) throw Error('More page identity changed');
        const moreSelector = device === 'PC' ? '.ad_section.section > ol.lst_type > li.lst' : 'a.txt_link[onclick*="sct.title"]';
        await page.locator(moreSelector).first().waitFor({state:'visible',timeout:Math.min(5000,Math.max(1,deadline-Date.now()))});
        let batch = await page.locator(moreSelector).evaluateAll((items, mobile) => items.filter(el=>el.getClientRects().length).map(el=>{
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
        if(appended){
          if(!validRankList(batch,1,true)||batch.length<=collected.length||collected.some((ad,i)=>ad.adId!==batch[i]?.adId||ad.rank!==batch[i]?.rank))throw Error('More cumulative list changed');
          batch=batch.slice(collected.length);
        }
        if(device==='MOBILE'){const normalized=mobileMoreBatch(batch,collected.length);if(!normalized)throw Error('More rank metadata invalid');batch=normalized;}
        if (!validRankList(batch,collected.length+1,device==='MOBILE')) throw Error('More rank metadata invalid');
        collected.push(...batch);
        if (!validRankList(collected,1,device==='MOBILE')) throw Error('Duplicate more ad IDs');
        morePages=pageIndex; moreObservedCount=collected.length;
        const found = matchRank(collected,expectedHost); moreStatus=found.status;
        if (found.status==='unknown') throw Error('Multiple matching ads');
        if (found.status==='visible') {result=found;source='MORE';moreRank=found.rank;observedAds=collected;break;}
        if(device==='MOBILE'){
          // Complete initial script loading before using the dynamic More control.
          await page.waitForLoadState('load',{timeout:Math.min(10000,Math.max(1,deadline-Date.now()))});
          const loadMore=page.locator('a#_get_more');
          if(await loadMore.count() && await loadMore.isVisible()){
            if(pageIndex===4){moreStatus='limit_reached';break;}
            const before=collected.length;
            let denied=false;
            const loadDiagnostics=[];
            const failed=request=>loadDiagnostics.push('request failed: '+(request.failure()?.errorText??'unknown'));
            const scriptError=error=>loadDiagnostics.push('script: '+error.message.slice(0,180));
            const checkResponse=response=>{if(response.status()===403)denied=true;if(response.status()>=400){const u=new URL(response.url());loadDiagnostics.push('HTTP '+response.status()+' '+response.request().resourceType()+' '+u.origin+u.pathname);}};
            page.on('response',checkResponse);page.on('requestfailed',failed);page.on('pageerror',scriptError);
            try{
              await loadMore.tap({timeout:Math.min(5000,Math.max(1,deadline-Date.now()))});
              await page.waitForFunction(({selector,before})=>document.querySelectorAll(selector).length>before,{selector:moreSelector,before},{timeout:Math.min(20000,Math.max(1,deadline-Date.now()))});
            }catch(error){if(denied)throw Error('Search HTTP 403');throw Error(error.message+'; more-load diagnostics: '+(loadDiagnostics.slice(-5).join(' | ')||'no HTTP/network/script error observed'));}
            finally{page.off('response',checkResponse);page.off('requestfailed',failed);page.off('pageerror',scriptError);}
            if(denied)throw Error('Search HTTP 403');
            appended=true;
            continue;
          }
        }
        const nextLinks = await page.locator(device==='PC'?'a.next[href]':'a[href]').evaluateAll(links=>links.filter(a=>a.getClientRects().length).map(a=>a.href));
        const next = nextLinks.map(u=>safeMoreUrl(u,keyword,device,pageIndex+1)).find(Boolean);
        if (!next) break;
        if (pageIndex===4) {moreStatus='limit_reached';break;}
        moreUrl=next;
      }
    } catch(error) { if(error.message==='Search HTTP 403')throw error; moreError=error.message; moreStatus='unknown'; result={status:'unknown',rank:null,adId:null}; source=null; }
  }
  console.log(JSON.stringify({keyword,expectedHost,device,observedAt:new Date().toISOString(),...result,
    source,mainRank,moreRank,mainObservedCount:ads.length,moreObservedCount,morePages,moreStatus,moreError,
    observedCount:source==='MORE'||morePages>0?moreObservedCount:ads.length,ads:observedAds,
    note:'Read-only observation from this VPS. More ranks are separate from main search ranks. No ad clicks or bid changes.'},null,2));
} catch (error) {
  console.log(JSON.stringify({ keyword, expectedHost, device, status: 'unknown', rank: null,
    error: error.message }, null, 2));
  process.exitCode = 1;
} finally { await browser.close(); }
