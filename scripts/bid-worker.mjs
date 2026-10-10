// Persistent VPS worker. No job is created here; only authenticated UI requests run.
import pg from 'pg';
import {randomUUID, createHmac} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {decryptCredentials} from '../lib/credentials.ts';
import {siteForGroup} from '../lib/ad-sites.ts';
import {runRotation} from '../lib/rotation.ts';
import {makeAutoJob} from '../lib/auto-job.ts';
import {assertAutoBid,cappedActualBid} from '../lib/auto-bid.ts';
if(!process.env.DATABASE_URL || !process.env.APP_PASSWORD || process.env.APP_PASSWORD.length<16) throw Error('DATABASE_URL and original APP_PASSWORD are required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:10000});
const db=await pool.connect(); // Advisory lock belongs to this exact persistent session.
const run=promisify(execFile), checker=fileURLToPath(new URL('./rank-check.mjs',import.meta.url));
let shutdown=false;
process.on('SIGINT',()=>{shutdown=true});process.on('SIGTERM',()=>{shutdown=true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const load=async id=>{const r=await db.query('SELECT data FROM bid_states WHERE id=$1',[id]);return r.rows[0]?JSON.parse(r.rows[0].data):null};
const save=(id,value)=>db.query('INSERT INTO bid_states(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data',[id,JSON.stringify(value)]);
const heartbeat=()=>save('auto-worker',{state:shutdown?'stopping':'online',updatedAt:new Date().toISOString()});
async function request(c,method,path,body){
 const ts=String(Date.now()), signature=createHmac('sha256',c.NAVER_SECRET_KEY).update(`${ts}.${method}.${path.split('?')[0]}`).digest('base64');
 const res=await fetch('https://api.searchad.naver.com'+path,{method,signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json','X-Timestamp':ts,'X-API-KEY':c.NAVER_API_KEY,'X-Customer':c.NAVER_CUSTOMER_ID,'X-Signature':signature},...(body?{body:JSON.stringify(body)}:{})});
 if(!res.ok) throw Error(`Naver API HTTP ${res.status}`);
 return res.json(); // A write timeout/invalid response is never retried.
}
async function execute(job){
 let stage="초기화",activeKeyword="";
 const update=async patch=>db.query("UPDATE bid_states SET data=(data::jsonb || $1::jsonb)::text WHERE id='auto' AND data::jsonb->>'jobId'=$2 AND data::jsonb->>'state' IN ('queued','running')",[JSON.stringify({...patch,updatedAt:new Date().toISOString()}),job.jobId]);
 const stopped=async()=>{await heartbeat();const current=await load('auto');return shutdown||current?.jobId!==job.jobId||current.state!=='running'};
 try{
  await update({state:'running',message:'전체 순위 조회'});
  const raw=await db.query("SELECT data FROM bid_states WHERE id='credentials'");
  if(!raw.rows.length)throw Error('저장된 네이버 연결 정보가 없습니다.');
  stage='연결 정보 복호화';
  const c=decryptCredentials(raw.rows[0].data);
  let cycle=0;
  while(!await stopped()){
   const state=await load('main');makeAutoJob(state,job.ids,job.device,job.waitSeconds,job.jobId);
   const rows=job.ids.map(id=>state.rows.find(r=>r.id===id));
   const byId=new Map(rows.map(r=>[r.id,r]));
   let completed=0; cycle++;
   await update({cycle,completed:0,total:rows.length,message:'전체 순위 조회'});
   const result=await runRotation(rows,job.device,job.waitSeconds,{
    now:()=>Date.now(),stopped,wait:async seconds=>{await heartbeat();await sleep(seconds*1000)},
    observe:async row=>{
     await heartbeat();const r=byId.get(row.id),host=siteForGroup(r.group);let observation;
     try{const {stdout}=await run(process.execPath,[checker,r.keyword,host,job.device],{timeout:75000,maxBuffer:1024*1024});observation=JSON.parse(stdout);
      if(observation.keyword!==r.keyword||observation.device!==job.device||observation.expectedHost!==host)throw Error('identity');
     }catch{observation={status:'unknown',rank:null,observedAt:new Date().toISOString(),observedCount:0};}
     await save(`rank:${job.device}:${r.id}`,{id:r.id,keyword:r.keyword,device:job.device,host,...observation,ads:undefined});
     completed++;await update({completed:Math.min(completed,rows.length),message:'순위 조회 · '+r.keyword});
     await sleep(3000);
     return {rank:observation.status==='visible'?observation.rank:null,device:job.device,observedAt:Date.parse(observation.observedAt)};
    },
    apply:async(id,expected,next)=>{
     const latest=await load('main');makeAutoJob(latest,job.ids,job.device,job.waitSeconds,job.jobId);
     const r=latest.rows.find(r=>r.id===id),original=byId.get(id);activeKeyword=r?.keyword??id;stage="설정 검증";
     if(r.bid!==expected||r.max<next||r.target!==original.target||r.group!==original.group||r.keyword!==original.keyword||next!==expected+10)throw Error('실행 중 설정이 변경되어 중지했습니다. 설정 확인 후 다시 실행하세요.');
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
     const log={keyword:r.keyword,before:expected,after:next,time:new Date().toISOString(),kind:'자동입찰',device:job.device,jobId:job.jobId};
     await db.query('INSERT INTO bid_logs(id,data,created) VALUES($1,$2,$3)',[attempt.id,JSON.stringify(log),log.time]);
     await save('bid-attempt:'+attempt.id,{...attempt,state:'confirmed'});
     return {status:'increased',bid:next};
    },
    event:async e=>{await update({message:e.status==='waiting'?`입찰 반영 ${job.waitSeconds}초 대기`:e.status==='unknown'?'순위 미확인 · 금액 유지':e.status==='reached'?'목표 이내 · 금액 유지':e.status==='capped'?'최대 입찰가 · 금액 유지':e.status==='increased'?'+10원 적용':'중지 확인',lastEvent:e});},
   });
   if(result.stopped)break;
   if(!result.changes){await update({state:'completed',message:'증액 대상 없음 · 목표/상한/미확인 상태 확인'});break;}
  }
 }catch(error){
  // Only explicitly whitelisted errors are shown; never persist raw network/credential errors.
  const detail=/^(Naver API HTTP \d{3}|Naver effective bid differs: saved=\d+, actual=\d+|Naver keyword\/group identity changed|Naver keyword or group is paused|Naver keyword or group is not eligible|Settings changed|Rank is not fresh or outside target)$/.test(error.message)?error.message:'상세 점검 필요';
  const message=`${activeKeyword?activeKeyword+' · ':''}${stage} 실패: ${detail}`;
  console.error(message);await update({state:'failed',stage,message,errorCode:detail});
 }
 const current=await load('auto');
 if(current?.jobId===job.jobId&&['running','stop_requested'].includes(current.state)) await db.query("UPDATE bid_states SET data=(data::jsonb || $1::jsonb)::text WHERE id='auto' AND data::jsonb->>'jobId'=$2",[JSON.stringify({state:'stopped',message:'자동입찰 중지',updatedAt:new Date().toISOString()}),job.jobId]);
}
try{
 const lock=await db.query('SELECT pg_try_advisory_lock(704031027) AS locked');
 if(!lock.rows[0].locked)throw Error('Another bid worker is already running');
 // Crash recovery never resumes an uncertain write or old job automatically.
 await db.query("UPDATE bid_states SET data=(data::jsonb || '{\"state\":\"interrupted\",\"message\":\"VPS 재시작으로 중지 · 네이버 확인 후 재실행\"}'::jsonb)::text WHERE id='auto' AND data::jsonb->>'state' IN ('running','stop_requested')");
 console.log('Bid worker online; waiting for an authenticated run request.');
 while(!shutdown){await heartbeat();const job=await load('auto');if(job?.state==='queued')await execute(job);else if(job?.state==='stop_requested'){await db.query("UPDATE bid_states SET data=(data::jsonb || '{\"state\":\"stopped\",\"message\":\"자동입찰 중지\"}'::jsonb)::text WHERE id='auto' AND data::jsonb->>'jobId'=$1 AND data::jsonb->>'state'='stop_requested'",[job.jobId]);}else await sleep(5000);}
 await save('auto-worker',{state:'offline',updatedAt:new Date().toISOString()});
}finally{await db.query('SELECT pg_advisory_unlock(704031027)').catch(()=>{});db.release();await pool.end();}
