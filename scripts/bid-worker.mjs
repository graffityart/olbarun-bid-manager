import { searchAccessDenied, SearchAccessDenied } from '../lib/search-access.ts';
import { reflectionRemaining } from '../lib/reflection-wait.ts';
// Persistent VPS worker. No job is created here; only authenticated UI requests run.
import pg from 'pg';
import {randomUUID, createHmac} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {decryptCredentials} from '../lib/credentials.ts';
import {siteForRow} from '../lib/ad-sites.ts';
import {runRotation} from '../lib/rotation.ts';
import {costDecision,costApplied} from '../lib/cost-policy.ts';
import {resumeSignature} from '../lib/resume-job.ts';
import {serialWork,searchDelay} from '../lib/shared-work.ts';
import {groupKey,assertGroupSelection} from '../lib/group-scope.ts';
import {makeAutoJob} from '../lib/auto-job.ts';
import {assertAutoBid,cappedActualBid,assertCostBid} from '../lib/auto-bid.ts';
if(!process.env.DATABASE_URL || !process.env.APP_PASSWORD || process.env.APP_PASSWORD.length<16) throw Error('DATABASE_URL and original APP_PASSWORD are required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:10000});
const db=await pool.connect(); // Advisory lock belongs to this exact persistent session.
const run=promisify(execFile), checker=fileURLToPath(new URL('./rank-check.mjs',import.meta.url));
let shutdown=false;
process.on('SIGINT',()=>{shutdown=true});process.on('SIGTERM',()=>{shutdown=true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const load=async id=>{const r=await db.query("SELECT (CASE WHEN id='auto' OR id LIKE 'auto-job:%' THEN data::jsonb #- '{checkpoint,observations}' ELSE data::jsonb END)::text AS data FROM bid_states WHERE id=$1",[id]);return r.rows[0]?JSON.parse(r.rows[0].data):null};
const save=(id,value)=>db.query('INSERT INTO bid_states(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data',[id,JSON.stringify(value)]);
const work=serialWork();let lastSearchStarted=0;
const heartbeat=()=>save('auto-worker',{resumeMode:true,multiGroup:true,lowestMode:true,strategy:'cost',state:shutdown?'stopping':'online',updatedAt:new Date().toISOString()});
async function request(c,method,path,body){
 const ts=String(Date.now()), signature=createHmac('sha256',c.NAVER_SECRET_KEY).update(`${ts}.${method}.${path.split('?')[0]}`).digest('base64');
 const res=await fetch('https://api.searchad.naver.com'+path,{method,signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json','X-Timestamp':ts,'X-API-KEY':c.NAVER_API_KEY,'X-Customer':c.NAVER_CUSTOMER_ID,'X-Signature':signature},...(body?{body:JSON.stringify(body)}:{})});
 if(!res.ok) throw Error(`Naver API HTTP ${res.status}`);
 return res.json(); // A write timeout/invalid response is never retried.
}
async function execute(job,key){
 let stage="초기화",activeKeyword="";
 const update=async patch=>db.query("UPDATE bid_states SET data=(data::jsonb || $1::jsonb)::text WHERE id=$3 AND data::jsonb->>'jobId'=$2 AND data::jsonb->>'state' IN ('queued','running')",[JSON.stringify({...patch,updatedAt:new Date().toISOString()}),job.jobId,key]);
 const stopped=async()=>{await heartbeat();const current=await load(key);return shutdown||current?.jobId!==job.jobId||current.state!=='running'};
 try{
  await update({state:'running',message:'전체 순위 조회'});
  const raw=await db.query("SELECT data FROM bid_states WHERE id='credentials'");
  if(!raw.rows.length)throw Error('저장된 네이버 연결 정보가 없습니다.');
  stage='연결 정보 복호화';
  const c=decryptCredentials(raw.rows[0].data);
  let cycle=job.startMode==='resume'?(job.cycle??0):0;let resume=job.startMode==='resume'?job.checkpoint:null;
  if(resume?.phase==='complete'){resume=null;while(job.nextCycleAt>Date.now()&&!await stopped())await sleep(Math.min(5000,job.nextCycleAt-Date.now()));}
  while(!await stopped()){
   const state=await load('main');makeAutoJob(state,job.ids,job.device,job.waitSeconds,job.jobId);assertGroupSelection(state.rows,job.ids,job.group);
   const rows=job.ids.map(id=>state.rows.find(r=>r.id===id));
   const byId=new Map(rows.map(r=>[r.id,r]));
   let completed=resume?.nextObserve??0;if(!resume)cycle++;
   await update({cycle,completed,total:rows.length,message:resume?'중지 지점에서 이어서 처리':'전체 순위 조회',nextCycleAt:null});
   const ports={
    resume:resume??undefined,checkpoint:async checkpoint=>{await db.query("UPDATE bid_states SET data=(data::jsonb || $1::jsonb)::text WHERE id=$3 AND data::jsonb->>'jobId'=$2 AND data::jsonb->>'state' IN ('running','stop_requested')",[JSON.stringify({checkpoint,resumeSignature:resumeSignature(state.rows,job)}),job.jobId,key]);},
    deferReflectionWait:true,now:()=>Date.now(),stopped,wait:async seconds=>{await heartbeat();await sleep(seconds*1000)},
    observe:async row=>{
     const change=await load(`bid-change:${row.id}`),policy=await load(`cost:${job.device}:${row.id}`);
     const changedAt=Math.max(change?.changedAt??0,policy?.changedAt??0);
     let remaining=reflectionRemaining(changedAt,Date.now(),job.waitSeconds);
     while(remaining>0){
      if(await stopped())return {rank:null,device:job.device,observedAt:Date.now()};
      await update({message:byId.get(row.id).keyword+` · 입찰 반영 잔여 ${remaining}초 대기`});
      await heartbeat();await sleep(Math.min(5,remaining)*1000);
      remaining=reflectionRemaining(changedAt,Date.now(),job.waitSeconds);
     }
     await heartbeat();const r=byId.get(row.id),host=siteForRow(r);let observation;
     const query=async()=>work(async()=>{
      const access=await load('search-access');
      while(access?.state==='blocked'&&Date.now()<access.retryAt){
       if(await stopped())return '';
       await update({message:'전체 검색 조회 휴식 · 접근 거부 재확인 대기',retryAt:access.retryAt});
       await sleep(Math.min(5000,access.retryAt-Date.now()));
      }
      const delay=searchDelay(lastSearchStarted,Date.now());
      if(delay)await sleep(delay);
      if(await stopped())return '';
      lastSearchStarted=Date.now();
      try{const {stdout}=await run(process.execPath,[checker,r.keyword,host,job.device],{timeout:180000,maxBuffer:1024*1024});if(searchAccessDenied(stdout))await save('search-access',{state:'blocked',retryAt:Date.now()+10*60*1000,updatedAt:new Date().toISOString()});return stdout;}
      catch(error){if(searchAccessDenied(String(error.stdout??''))){await save('search-access',{state:'blocked',retryAt:Date.now()+10*60*1000,updatedAt:new Date().toISOString()});return String(error.stdout);}return '';}
     });
     let output=await query();
     if(searchAccessDenied(output)){
      const retryAt=Date.now()+10*60*1000;
      await save('search-access',{state:'blocked',retryAt,updatedAt:new Date().toISOString()});
      await save(`rank:${job.device}:${r.id}`,{id:r.id,keyword:r.keyword,device:job.device,host,status:'access_denied',rank:null,observedAt:new Date().toISOString(),observedCount:0});
      while(Date.now()<retryAt){
       if(await stopped())return {rank:null,device:job.device,observedAt:Date.now()};
       await update({message:`네이버 검색 접근 거부(403) · 전체 조회 중단 · ${new Date(retryAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'})} 한 번 재확인`,retryAt});
       await heartbeat();await sleep(Math.min(5000,retryAt-Date.now()));
      }
      if(await stopped())return {rank:null,device:job.device,observedAt:Date.now()};
      output=await query();
      if(searchAccessDenied(output)){
       await save('search-access',{state:'blocked',retryAt:Date.now()+10*60*1000,updatedAt:new Date().toISOString()});
       throw new SearchAccessDenied();
      }
      if(!output)throw new SearchAccessDenied();
      await save('search-access',{state:'available',updatedAt:new Date().toISOString()});
     }
     try{observation=JSON.parse(output);if(observation.keyword!==r.keyword||observation.device!==job.device||observation.expectedHost!==host)throw Error('identity');}
     catch{observation={status:'unknown',rank:null,observedAt:new Date().toISOString(),observedCount:0};}
     const oldRank=await load(`rank:${job.device}:${r.id}`);
     await save(`rank:${job.device}:${r.id}`,{id:r.id,keyword:r.keyword,device:job.device,host,...observation,ads:undefined,optimization:oldRank?.optimization});
     completed++;await update({completed:Math.min(completed,rows.length),message:'순위 조회 · '+r.keyword});

     return {rank:observation.status==='visible'?observation.rank:null,device:job.device,observedAt:Date.parse(observation.observedAt)};
    },
    manage:async(row,fresh)=>{
     const id=row.id,latest=await load('main');makeAutoJob(latest,job.ids,job.device,job.waitSeconds,job.jobId);
     const r=latest.rows.find(r=>r.id===id),original=byId.get(id);activeKeyword=r?.keyword??id;stage='감액 설정 검증';
     if(!r||r.target!==original.target||r.max!==original.max||r.min!==original.min||groupKey(r)!==groupKey(original)||r.keyword!==original.keyword)throw Error('Settings changed');
     const key=`cost:${job.device}:${id}`,previous=await load(key),observation=await load(`rank:${job.device}:${id}`);
     const display=async(policy,reason)=>{
      await save(key,policy);
      await save(`rank:${job.device}:${id}`,{...observation,optimization:{status:reason,goodBid:policy.goodBid??null,pending:policy.pending??null,cooldownUntil:policy.cooldownUntil,changedAt:policy.changedAt}});
      await update({message:r.keyword+' · '+reason});
     };
     if(!fresh.rank){if(previous)await display({...previous,stable:0},'순위 미확인 · 금액 유지');return {changed:false,status:'unknown',bid:r.bid};}
     stage='네이버 현재 금액 조회';
     const kw=await request(c,'GET',`/ncc/keywords/${encodeURIComponent(id)}`);
     const group=await request(c,'GET',`/ncc/adgroups/${encodeURIComponent(kw.nccAdgroupId)}`);
     cappedActualBid(r,kw,group);const actual=kw.useGroupBidAmt?group.bidAmt:kw.bidAmt;
     if(r.bid!==actual){
      await db.query("UPDATE bid_states SET data=jsonb_set(data::jsonb,ARRAY['rows',x.idx::text,'bid'],$1::jsonb)::text FROM (SELECT (ordinality-1) idx FROM bid_states,jsonb_array_elements(data::jsonb->'rows') WITH ORDINALITY e WHERE id='main' AND e.value->>'id'=$2) x WHERE bid_states.id='main'",[JSON.stringify(actual),id]);
      // Never make a second change using a rank captured at an uncertain bid.
      await update({message:r.keyword+' · 실제 금액 갱신 · 다음 조회 후 판단'});
      return {changed:false,status:'monitoring',bid:actual};
     }
     const decision=costDecision({bid:actual,min:r.min??70,max:r.max,target:r.target,rank:fresh.rank,source:observation?.source??null,device:job.device,group:groupKey(r),observedAt:fresh.observedAt,now:Date.now(),waitSeconds:job.waitSeconds,stableChecks:2,exactRank:!!job.lowestRank,reductionAmount:10},previous);
     if(decision.action==='hold'||(job.strategy!=='cost'&&decision.action==='reduce')){await display(decision.state,job.strategy!=='cost'&&decision.action==='reduce'?'목표 이내 · 금액 유지':decision.reason);return {changed:false,status:'monitoring',bid:actual};}
     if(observation?.source==='MORE'){
      const creatives=await request(c,'GET',`/ncc/ads?nccAdgroupId=${encodeURIComponent(kw.nccAdgroupId)}`);
      if(!Array.isArray(creatives)||!creatives.some(ad=>ad.nccAdId===observation.adId&&ad.nccAdgroupId===kw.nccAdgroupId))throw Error('Naver keyword/group identity changed');
     }
     stage='증감액 안전 검증';
     assertCostBid(r,original,kw,group,actual,decision.next,observation,job.device,Date.now(),decision.action);
     const attempt={id:randomUUID(),jobId:job.jobId,keywordId:id,keyword:r.keyword,before:actual,after:decision.next,action:decision.action,state:'pending',time:new Date().toISOString()};
     if(await stopped())return {changed:false,stopped:true,status:'stopped',bid:actual};
     // Persist the expected amount before PUT. An ambiguous result stays blocked
     // across restarts/new jobs until this exact amount is confirmed externally.
     const blocked=costApplied(decision.state,decision.action,actual,decision.next,Date.now());
     await save('bid-attempt:'+attempt.id,attempt);await save(key,blocked);
     if(await stopped()){await save(key,previous??decision.state);await save('bid-attempt:'+attempt.id,{...attempt,state:'cancelled'});return {changed:false,stopped:true,status:'stopped',bid:actual};}
     stage='네이버 증감액 적용';
     await request(c,'PUT','/ncc/keywords?fields=bidAmt',[{...kw,bidAmt:decision.next,useGroupBidAmt:false}]);
     const confirmed=await request(c,'GET',`/ncc/keywords/${encodeURIComponent(id)}`);
     if(confirmed.bidAmt!==decision.next||confirmed.useGroupBidAmt)throw Error('Settings changed');
     const applied=costApplied(decision.state,decision.action,actual,decision.next,Date.now());
     await display(applied,decision.action==='reduce'?'감액 시험 · 반영 확인 대기':decision.action==='restore'?'이전 금액 복구 · 순위 재확인':'50원 증액 · 반영 확인 대기');
     await db.query("UPDATE bid_states SET data=jsonb_set(data::jsonb,ARRAY['rows',x.idx::text,'bid'],$1::jsonb)::text FROM (SELECT (ordinality-1) idx FROM bid_states,jsonb_array_elements(data::jsonb->'rows') WITH ORDINALITY e WHERE id='main' AND e.value->>'id'=$2) x WHERE bid_states.id='main'",[JSON.stringify(decision.next),id]);
     const log={group:job.group,groupName:r.group,campaignName:r.campaignName,keyword:r.keyword,keywordId:id,before:actual,after:decision.next,time:new Date().toISOString(),kind:decision.action==='reduce'?'자동감액':decision.action==='restore'?'순위복구':'자동입찰',device:job.device,source:observation.source,jobId:job.jobId};
     await db.query('INSERT INTO bid_logs(id,data,created) VALUES($1,$2,$3)',[attempt.id,JSON.stringify(log),log.time]);
     await save('bid-attempt:'+attempt.id,{...attempt,state:'confirmed'});
     return {changed:true,bid:decision.next,status:decision.action==='reduce'?'reduced':decision.action==='restore'?'restored':'increased'};
    },
    apply:async(id,expected,next)=>{
     const latest=await load('main');makeAutoJob(latest,job.ids,job.device,job.waitSeconds,job.jobId);
     const r=latest.rows.find(r=>r.id===id),original=byId.get(id);activeKeyword=r?.keyword??id;stage="설정 검증";
     if(r.bid!==expected||r.max<next||r.target!==original.target||groupKey(r)!==groupKey(original)||r.keyword!==original.keyword||next!==expected+10)throw Error('실행 중 설정이 변경되어 중지했습니다. 설정 확인 후 다시 실행하세요.');
     stage='네이버 키워드 조회';
     const kw=await request(c,'GET',`/ncc/keywords/${encodeURIComponent(id)}`);
     stage='네이버 그룹 조회';
     const group=await request(c,'GET',`/ncc/adgroups/${encodeURIComponent(kw.nccAdgroupId)}`);
     const actualCap=cappedActualBid(r,kw,group);
     if(actualCap!==null){
      // Reconcile only the displayed bid. Never change target/max or Naver bid.
      await db.query("UPDATE bid_states SET data=jsonb_set(data::jsonb,ARRAY['rows',x.idx::text,'bid'],$1::jsonb)::text FROM (SELECT (ordinality-1) idx FROM bid_states,jsonb_array_elements(data::jsonb->'rows') WITH ORDINALITY e WHERE id='main' AND e.value->>'id'=$2) x WHERE bid_states.id='main'",[JSON.stringify(actualCap),id]);
      return {status:'capped',bid:actualCap};
     }
     // The live effective bid is the baseline; never add ten to stale UI data.
     expected=kw.useGroupBidAmt?group.bidAmt:kw.bidAmt;
     next=expected+10;
     r.bid=expected;
     const observation=await load(`rank:${job.device}:${id}`);
     // More pages may expose only a display URL: verify the observed creative
     // belongs to this Naver ad group before using that rank for a write.
     if(observation?.source==='MORE') {
      const creatives=await request(c,'GET',`/ncc/ads?nccAdgroupId=${encodeURIComponent(kw.nccAdgroupId)}`);
      if(!Array.isArray(creatives)||!creatives.some(ad=>ad.nccAdId===observation.adId&&ad.nccAdgroupId===kw.nccAdgroupId))throw Error('Naver keyword/group identity changed');
     }
     stage="현재 입찰가·광고 상태 검증";
     assertAutoBid(r,original,kw,group,expected,next,observation,job.device,Date.now());
     const attempt={id:randomUUID(),jobId:job.jobId,keyword:r.keyword,before:expected,after:next,state:'pending',time:new Date().toISOString()};
     if(await stopped())return false;
     await save('bid-attempt:'+attempt.id,attempt);
     if(await stopped()){await save('bid-attempt:'+attempt.id,{...attempt,state:'cancelled'});return false;}
     stage='네이버 입찰 변경';
     await request(c,'PUT','/ncc/keywords?fields=bidAmt',[{...kw,bidAmt:next,useGroupBidAmt:false}]);
     stage='변경 결과 검증';
     const confirmed=await request(c,'GET',`/ncc/keywords/${encodeURIComponent(id)}`);
     if(confirmed.bidAmt!==next||confirmed.useGroupBidAmt)throw Error('입찰 변경 결과를 확정할 수 없어 중지했습니다. 네이버에서 확인 후 동기화하세요.');
     stage='변경 기록 저장';
     // Update only the bid, preserving any concurrent UI settings.
     await db.query("UPDATE bid_states SET data=jsonb_set(data::jsonb,ARRAY['rows',x.idx::text,'bid'],$1::jsonb)::text FROM (SELECT (ordinality-1) idx FROM bid_states,jsonb_array_elements(data::jsonb->'rows') WITH ORDINALITY e WHERE id='main' AND e.value->>'id'=$2) x WHERE bid_states.id='main'",[JSON.stringify(next),id]);
     const log={group:job.group,groupName:r.group,campaignName:r.campaignName,keywordId:id,keyword:r.keyword,before:expected,after:next,time:new Date().toISOString(),kind:'자동입찰',device:job.device,jobId:job.jobId};
     await db.query('INSERT INTO bid_logs(id,data,created) VALUES($1,$2,$3)',[attempt.id,JSON.stringify(log),log.time]);
     await save('bid-attempt:'+attempt.id,{...attempt,state:'confirmed'});
     return {status:'increased',bid:next};
    },
    event:async e=>{if(['increased','reduced','restored'].includes(e.status)&&e.id)await save(`bid-change:${e.id}`,{changedAt:Date.now()});if(e.status==='monitoring'){await update({lastEvent:e});return;}await update({message:e.status==='waiting'?`입찰 반영 ${job.waitSeconds}초 대기`:e.status==='unknown'?'순위 미확인 · 금액 유지':e.status==='reached'?'목표 이내 · 금액 유지':e.status==='capped'?'최대 입찰가 · 금액 유지':e.status==='increased'?'+10원 적용':e.status==='reduced'?'감액 적용 · 순위 재확인':e.status==='restored'?'이전 금액 복구':e.status==='monitoring'?'목표 순위·절감 상태 감시 중':'중지 확인',lastEvent:e});},
   };
   const manage=ports.manage;
   if(manage)ports.manage=async(row,fresh)=>{
    // Acquire a fresh observation before entering the write queue; do not hold
    // the queue while waiting for a keyword's reflection window.
    if(Date.now()-fresh.observedAt>60000)fresh=await ports.observe(row);
    return work(async()=>{
     if(await stopped())return {changed:false,stopped:true,status:'stopped',bid:row.bid};
     const access=await load('search-access');
     if(access?.state==='blocked'&&access.retryAt>Date.now())return {changed:false,status:'unknown',bid:row.bid};
     if(Date.now()-fresh.observedAt>60000)return {changed:false,status:'unknown',bid:row.bid};
     return manage(row,fresh);
    });
   };
   const result=await runRotation(rows,job.device,job.waitSeconds,ports);resume=null;
   if(result.stopped)break;
   if(!result.changes){
    await update({message:'순위 감시 중 · 다음 전체 조회 대기',nextCycleAt:Date.now()+job.waitSeconds*1000});
    for(let remaining=job.waitSeconds;remaining>0&&!await stopped();remaining-=5){await heartbeat();await sleep(Math.min(5,remaining)*1000);}
   }
  }
 }catch(error){
  // Only explicitly whitelisted errors are shown; never persist raw network/credential errors.
  const detail=/^(Naver API HTTP \d{3}|Naver effective bid differs: saved=\d+, actual=\d+|Naver keyword\/group identity changed|Naver keyword or group is paused|Naver keyword or group is not eligible|Settings changed|Rank is not fresh or outside target)$/.test(error.message)?error.message:'상세 점검 필요';
  const message=error.name==='SearchAccessDenied'?'네이버 검색 접근 거부(403) · 재확인 실패로 자동입찰 종료 · 금액 유지':`${activeKeyword?activeKeyword+' · ':''}${stage} 실패: ${detail}`;
  console.error(message);await update({state:'failed',stage,message,errorCode:detail});
 }
 const current=await load(key);
 if(current?.jobId===job.jobId&&['running','stop_requested'].includes(current.state)) await db.query("UPDATE bid_states SET data=(data::jsonb || $1::jsonb)::text WHERE id=$3 AND data::jsonb->>'jobId'=$2",[JSON.stringify({state:'stopped',message:'자동입찰 중지',updatedAt:new Date().toISOString()}),job.jobId,key]);
}
try{
 const lock=await db.query('SELECT pg_try_advisory_lock(704031027) AS locked');
 if(!lock.rows[0].locked)throw Error('Another bid worker is already running');
 // Crash recovery never resumes an uncertain write or old job automatically.
 await db.query("UPDATE bid_states SET data=(data::jsonb || '{\"state\":\"interrupted\",\"message\":\"VPS 재시작으로 중지 · 네이버 확인 후 재실행\"}'::jsonb)::text WHERE (id='auto' OR id LIKE 'auto-job:%') AND data::jsonb->>'state' IN ('running','stop_requested')");
 console.log('Bid worker online; waiting for an authenticated run request.');
 const tasks=new Map();
 while(!shutdown){
  await heartbeat();
  const records=await db.query("SELECT id,(CASE WHEN data::jsonb->>'state'='queued' THEN data::jsonb ELSE data::jsonb #- '{checkpoint,observations}' END)::text AS data FROM bid_states WHERE id='auto' OR id LIKE 'auto-job:%' ORDER BY id");
  for(const record of records.rows){
   const job=JSON.parse(record.data),key=record.id;
   if(job.state==='queued'&&!tasks.has(key)){
    const task=execute(job,key).catch(()=>console.error('Group worker failed; inspect job status')).finally(()=>tasks.delete(key));tasks.set(key,task);
   }else if(job.state==='stop_requested'&&!tasks.has(key))await db.query("UPDATE bid_states SET data=(data::jsonb || '{\"state\":\"stopped\",\"message\":\"자동입찰 중지\"}'::jsonb)::text WHERE id=$1 AND data::jsonb->>'jobId'=$2 AND data::jsonb->>'state'='stop_requested'",[key,job.jobId]);
  }
  await sleep(5000);
 }
 await Promise.allSettled([...tasks.values()]);
 await save('auto-worker',{state:'offline',updatedAt:new Date().toISOString()});
}finally{await db.query('SELECT pg_advisory_unlock(704031027)').catch(()=>{});db.release();await pool.end();}
