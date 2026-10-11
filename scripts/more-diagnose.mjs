import { chromium, devices } from 'playwright';
const keyword=process.argv[2]||'부산철거전문업체';
const browser=await chromium.launch({headless:true});
const safePath=raw=>{try{const u=new URL(raw);return u.origin+u.pathname;}catch{return 'unknown';}};
try{
 for(const mode of ['DIRECT','SEARCH']){
  const context=await browser.newContext({...devices['iPhone 13'],locale:'ko-KR'});
  const events=[];
  const attach=page=>{
   page.on('pageerror',e=>events.push({kind:'script_error',message:e.message.slice(0,200)}));
   page.on('requestfailed',r=>events.push({kind:'failed',type:r.resourceType(),path:safePath(r.url()),error:r.failure()?.errorText}));
   page.on('response',r=>{const type=r.request().resourceType();if(['script','xhr','fetch'].includes(type))events.push({kind:'response',status:r.status(),type,path:safePath(r.url())});});
  };
  try{
   let url='https://m.ad.search.naver.com/search.naver?where=m_expd&query='+encodeURIComponent(keyword);
   if(mode==='SEARCH'){
    const main=await context.newPage();attach(main);
    const response=await main.goto('https://m.search.naver.com/search.naver?query='+encodeURIComponent(keyword),{waitUntil:'load',timeout:30000});
    if(response?.status()!==200)throw Error('Search HTTP '+response?.status());
    url=await main.locator('a[href]').evaluateAll(links=>links.find(a=>a.getClientRects().length&&new URL(a.href).hostname==='m.ad.search.naver.com')?.href);
    if(!url)throw Error('No mobile More link');
   }
   const page=await context.newPage();attach(page);
   const response=await page.goto(url,{waitUntil:'load',timeout:30000});
   if(response?.status()!==200)throw Error('More HTTP '+response?.status());
   const ads=page.locator('a.txt_link[onclick*="sct.title"]');
   const button=page.locator('#_get_more');
   const before=await ads.count();
   const metadata=await button.evaluate(el=>({total:el.getAttribute('data-total'),pageSize:el.getAttribute('data-page-size'),hasReference:!!new URL(el.getAttribute('data-more-ads-url'),location.href).searchParams.get('referenceId')}));
   events.push({kind:'TAP_START'});
   await button.tap({timeout:5000});
   await page.waitForFunction(n=>document.querySelectorAll('a.txt_link[onclick*="sct.title"]').length>n,before,{timeout:10000}).catch(()=>{});
   console.log(JSON.stringify({mode,keyword,before,after:await ads.count(),metadata,events},null,2));
  }catch(e){console.log(JSON.stringify({mode,error:e.message,events},null,2));if(/HTTP 403|HTTP 429/.test(e.message))break;}
  finally{await context.close();}
 }
}finally{await browser.close();}
