// Read-only: fetch effective bid/status for a keyword. Never submits a bid.
import pg from 'pg';
import {createHmac} from 'node:crypto';
import {decryptCredentials} from '../lib/credentials.ts';
const keyword=process.argv[2];
if(!keyword)throw Error('Specify a keyword');
if(!process.env.DATABASE_URL||!process.env.APP_PASSWORD)throw Error('DATABASE_URL and original APP_PASSWORD required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:10000});
let stage='DB 연결';
try{
 const states=await pool.query("SELECT id,data FROM bid_states WHERE id IN ('main','credentials')");
 const state=JSON.parse(states.rows.find(r=>r.id==='main')?.data??'null');
 const matches=state?.rows?.filter(r=>r.keyword===keyword)??[];
 if(matches.length!==1)throw Error('Keyword must match exactly one saved row');
 const row=matches[0];stage='연결 정보 복호화';
 const c=decryptCredentials(states.rows.find(r=>r.id==='credentials').data);
 async function get(path){
  const ts=String(Date.now()),sig=createHmac('sha256',c.NAVER_SECRET_KEY).update(`${ts}.GET.${path}`).digest('base64');
  const response=await fetch('https://api.searchad.naver.com'+path,{signal:AbortSignal.timeout(20000),headers:{'X-Timestamp':ts,'X-API-KEY':c.NAVER_API_KEY,'X-Customer':c.NAVER_CUSTOMER_ID,'X-Signature':sig}});
  if(!response.ok)throw Error(`Naver API HTTP ${response.status}`);return response.json();
 }
 stage='네이버 키워드 조회';const kw=await get('/ncc/keywords/'+encodeURIComponent(row.id));
 stage='네이버 그룹 조회';const group=await get('/ncc/adgroups/'+encodeURIComponent(kw.nccAdgroupId));
 console.log(JSON.stringify({readOnly:true,keyword,savedBid:row.bid,keywordBid:kw.bidAmt,useGroupBidAmt:kw.useGroupBidAmt,effectiveBid:kw.useGroupBidAmt?group.bidAmt:kw.bidAmt,keywordStatus:kw.status,groupStatus:group.status,keywordPaused:kw.userLock,groupPaused:group.userLock,groupName:group.name,groupType:group.adgroupType,target:row.target,max:row.max},null,2));
}catch(error){console.error(JSON.stringify({readOnly:true,stage,error:/^Naver API HTTP \d{3}$/.test(error.message)?error.message:'이 단계에서 실패했습니다. 비밀번호나 연결 문자열을 출력하지 마세요.'}));process.exitCode=1;}
finally{await pool.end();}
