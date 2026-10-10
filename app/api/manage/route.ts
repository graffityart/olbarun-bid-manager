import {makeAutoJob,activeAutoStates} from "@/lib/auto-job";
import {assertGroupSelection} from "@/lib/group-scope";
import {siteForGroup} from "@/lib/ad-sites";
import {database} from "@/lib/db";
export const runtime="nodejs";
export const maxDuration=60;
import {encryptCredentials,decryptCredentials,type Credentials} from "@/lib/credentials";
async function credentials():Promise<Credentials|null>{const row=await db().prepare("SELECT data FROM bid_states WHERE id=?").bind("credentials").first();if(row){try{return decryptCredentials(row.data)}catch{throw Error("저장한 연결 정보를 읽을 수 없습니다. 비밀번호를 변경했다면 네이버 정보를 다시 연결하세요.")}}const e=process.env;return e.NAVER_CUSTOMER_ID&&e.NAVER_API_KEY&&e.NAVER_SECRET_KEY?{NAVER_CUSTOMER_ID:e.NAVER_CUSTOMER_ID,NAVER_API_KEY:e.NAVER_API_KEY,NAVER_SECRET_KEY:e.NAVER_SECRET_KEY}:null}
const db=database;
async function naver(method:string,path:string,body?:unknown,supplied?:Credentials){
 const e=supplied??await credentials();
 if(!e||!e.NAVER_CUSTOMER_ID||!e.NAVER_API_KEY||!e.NAVER_SECRET_KEY)throw new Error("네이버 광고 연결이 필요합니다. 연결 안내를 확인하세요.");
 const ts=Date.now().toString();const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(e.NAVER_SECRET_KEY),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`${ts}.${method}.${path.split("?")[0]}`));const signature=btoa(String.fromCharCode(...new Uint8Array(sig)));
 const r=await fetch(`https://api.searchad.naver.com${path}`,{method,headers:{"Content-Type":"application/json","X-Timestamp":ts,"X-API-KEY":e.NAVER_API_KEY,"X-Customer":e.NAVER_CUSTOMER_ID,"X-Signature":signature},...(body?{body:JSON.stringify(body)}:{})});
 if(!r.ok)throw new Error(`네이버 API 요청 실패 (${r.status}). 연결 정보와 권한을 확인하세요.`);return r.json() as Promise<any>;
}
export async function GET(){try{const row=await db().prepare("SELECT data FROM bid_states WHERE id = ?").bind("main").first();const logs=await db().prepare("SELECT data FROM bid_logs ORDER BY created DESC LIMIT 100").all();const ranks=await db().prepare("SELECT data FROM bid_states WHERE id LIKE 'rank:%'").all();const worker=await db().prepare("SELECT data FROM bid_states WHERE id=?").bind("rank-worker").first();const auto=await db().prepare("SELECT data FROM bid_states WHERE id=?").bind("auto").first();const autoWorker=await db().prepare("SELECT data FROM bid_states WHERE id=?").bind("auto-worker").first();return Response.json({auto:auto?JSON.parse(auto.data):null,autoWorker:autoWorker?JSON.parse(autoWorker.data):null,ranks:ranks.results.map((r:any)=>JSON.parse(r.data)),worker:worker?JSON.parse(worker.data):null,connected:await credentials().then(Boolean).catch(()=>false),state:row?JSON.parse(row.data):null,logs:logs.results.map((r:any)=>JSON.parse(r.data))})}catch(err){return Response.json({error:(err as Error).message},{status:503})}}
export async function POST(req:Request){try{
 const origin=req.headers.get("origin");if(origin&&new URL(origin).host!==req.headers.get("host"))return Response.json({error:"다른 사이트에서 보낸 요청은 허용되지 않습니다."},{status:403});
 const b=await req.json() as any;
 if(b.action==="auto-start"){
 const saved=await db().prepare("SELECT data FROM bid_states WHERE id=?").bind("main").first();
 const worker=await db().prepare("SELECT data FROM bid_states WHERE id=?").bind("auto-worker").first();const w=worker?JSON.parse(worker.data):null;
 if(!w||w.state!=="online"||!Number.isFinite(Date.parse(w.updatedAt))||Date.now()-Date.parse(w.updatedAt)>90000)throw Error("VPS 자동입찰 서비스를 먼저 실행하세요. 서버 연결이 확인되지 않았습니다.");
 if(w.strategy!=="cost")throw Error("VPS 코드를 업데이트하고 작업기를 재시작하세요. 자동 절감 기능 준비가 필요합니다.");
 if(!await credentials())throw Error("네이버 연결 정보를 먼저 저장하세요.");
 const savedState=saved?JSON.parse(saved.data):null;
 const job={...makeAutoJob(savedState,Array.isArray(b.rows)?b.rows.map((r:any)=>r.id):[],b.device,b.waitSeconds,crypto.randomUUID()),group:b.group,lowestRank:b.lowestRank??null,strategy:b.lowestRank===null?"increase":"cost"};
 assertGroupSelection(savedState.rows,job.ids,b.group);
 if(b.lowestRank!==undefined&&b.lowestRank!==null&&(!Number.isInteger(b.lowestRank)||b.lowestRank<1||b.lowestRank>5||job.ids.some((id:string)=>savedState.rows.find((r:any)=>r.id===id)?.target!==b.lowestRank)))throw Error("최저가 순위와 키워드 목표 순위를 확인하세요.");
 if(b.lowestRank!==undefined&&!w.lowestMode)throw Error("최저가 모드 사용을 위해 VPS 코드를 업데이트하고 재시작하세요.");
 const result=await db().prepare("INSERT INTO bid_states(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE bid_states.data::jsonb->>'state' NOT IN ('queued','running','stop_requested')").bind("auto",JSON.stringify(job)).run();
 if(!result.rowCount)throw Error("이미 실행 중입니다. 중지 후 다시 실행하세요.");return Response.json({...job,message:"실행 요청을 저장했습니다. VPS에서 전체 순위 조회를 시작합니다."});}
 if(b.action==="auto-stop"){
 await db().prepare("UPDATE bid_states SET data=(data::jsonb || '{\"state\":\"stop_requested\",\"message\":\"중지 요청 확인 중\"}'::jsonb)::text WHERE id='auto' AND data::jsonb->>'state' IN ('queued','running')").run();return Response.json({state:"stop_requested",message:"중지를 요청했습니다. 진행 중인 조회나 입찰 요청이 끝나면 다음 증액을 중지합니다."});}
 const existing=await db().prepare("SELECT data FROM bid_states WHERE id=?").bind("auto").first();
 if(existing&&activeAutoStates.includes(JSON.parse(existing.data).state)&&['save','sync','apply','connect'].includes(b.action))throw Error("자동입찰 중에는 설정과 수동 입찰을 변경할 수 없습니다. 중지 완료 후 변경하세요.");

 if(b.action==="connect"){const c:Credentials={NAVER_CUSTOMER_ID:String(b.customerId??"").trim(),NAVER_API_KEY:String(b.apiKey??"").trim(),NAVER_SECRET_KEY:String(b.secretKey??"").trim()};if(!/^\d+$/.test(c.NAVER_CUSTOMER_ID)||!c.NAVER_API_KEY||!c.NAVER_SECRET_KEY||c.NAVER_API_KEY.length>1000||c.NAVER_SECRET_KEY.length>1000)throw Error("Customer ID와 API 정보를 확인하세요.");const campaigns=await naver("GET","/ncc/campaigns",undefined,c);await db().prepare("INSERT INTO bid_states (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind("credentials",encryptCredentials(c)).run();return Response.json({ok:true,campaignCount:Array.isArray(campaigns)?campaigns.length:0})}

 if(b.action==="save"){if(!Array.isArray(b.rows)||b.rows.length>5000)throw new Error("키워드 목록이 올바르지 않습니다.");await db().prepare("INSERT INTO bid_states (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind("main",JSON.stringify({rows:b.rows.map((r:any)=>({...r,siteHost:siteForGroup(r.group)})),mode:b.mode,device:b.device==="PC"?"PC":"MOBILE"})).run();return Response.json({ok:true})}
 if(b.action==="sync"){const groups=await naver("GET","/ncc/adgroups");const rows=[];for(const g of groups){if(g.adgroupType!=="WEB_SITE")continue;const keywords=await naver("GET",`/ncc/keywords?nccAdgroupId=${encodeURIComponent(g.nccAdgroupId)}`);for(const k of keywords)rows.push({id:k.nccKeywordId,keyword:k.keyword,group:g.name,siteHost:siteForGroup(g.name),bid:k.useGroupBidAmt?g.bidAmt:k.bidAmt,min:70,max:1500,target:4,step:10,enabled:false,selected:false});}await db().prepare("UPDATE bid_states b SET data=jsonb_build_object('context','','stable',0,'lastObservation',0,'changedAt',0,'cooldownUntil',0,'appliedBid',(r.value->>'bid')::int)::text FROM jsonb_array_elements(?::jsonb) r(value) WHERE b.id IN ('cost:PC:'||(r.value->>'id'),'cost:MOBILE:'||(r.value->>'id'))").bind(JSON.stringify(rows.map((r:any)=>({id:r.id,bid:r.bid})))).run();return Response.json({rows})}
 if(b.action==="estimate"){if(!Array.isArray(b.rows)||b.rows.length>50)throw new Error("한 번에 50개 이하를 선택하세요.");const items=await naver("POST","/estimate/average-position-bid/keyword",{device:b.device==="PC"?"PC":"MOBILE",items:b.rows.map((r:any)=>({key:r.keyword,position:r.target}))});return Response.json({items:items.estimate??items})}
 if(b.action==="apply"){const saved=await db().prepare("SELECT data FROM bid_states WHERE id=?").bind("main").first();const state=saved?JSON.parse(saved.data):null;if(!state||state.mode!=="live")throw new Error("실제 계정의 키워드를 먼저 동기화하고 저장하세요.");if(!Array.isArray(b.changes)||b.changes.length>50)throw new Error("한 번에 50개 이하를 적용하세요.");const results=[];
 for(const c of b.changes){const row=state.rows.find((r:any)=>r.id===c.id);if(!row||!Number.isInteger(c.bid)||c.bid<row.min||c.bid>row.max||c.bid%10)throw new Error("허용 범위를 벗어난 입찰가입니다.");const current=await naver("GET",`/ncc/keywords/${encodeURIComponent(c.id)}`);const before=current.bidAmt;await naver("PUT","/ncc/keywords?fields=bidAmt",[{...current,bidAmt:c.bid,useGroupBidAmt:false}]);const log={keyword:row.keyword,before,after:c.bid,time:new Date().toISOString(),kind:"실제 적용"};await db().prepare("INSERT INTO bid_logs (id,data,created) VALUES (?,?,?)").bind(crypto.randomUUID(),JSON.stringify(log),log.time).run();results.push(log)}return Response.json({results})}
 throw new Error("지원하지 않는 요청입니다.");
 }catch(err){return Response.json({error:(err as Error).message},{status:400})}}
