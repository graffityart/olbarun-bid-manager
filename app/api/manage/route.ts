import {resumeSignature,resumeCheckpoint,publicJob} from "@/lib/resume-job";
import {makeAutoJob,activeAutoStates} from "@/lib/auto-job";
import {assertGroupSelection,groupKey,autoJobKey} from "@/lib/group-scope";
import {siteForGroup,siteForRow,normalizeAdHost} from "@/lib/ad-sites";
import {database,withManagementLock} from "@/lib/db";
export const runtime="nodejs";
export const maxDuration=60;
import {encryptCredentials,decryptCredentials,type Credentials} from "@/lib/credentials";
async function credentials(store=database):Promise<Credentials|null>{const row=await store().prepare("SELECT data FROM bid_states WHERE id=?").bind("credentials").first();if(row){try{return decryptCredentials(row.data)}catch{throw Error("저장한 연결 정보를 읽을 수 없습니다. 비밀번호를 변경했다면 네이버 정보를 다시 연결하세요.")}}const e=process.env;return e.NAVER_CUSTOMER_ID&&e.NAVER_API_KEY&&e.NAVER_SECRET_KEY?{NAVER_CUSTOMER_ID:e.NAVER_CUSTOMER_ID,NAVER_API_KEY:e.NAVER_API_KEY,NAVER_SECRET_KEY:e.NAVER_SECRET_KEY}:null}
const db=database;
async function naverRequest(method:string,path:string,body?:unknown,supplied?:Credentials){
 const e=supplied??await credentials();
 if(!e||!e.NAVER_CUSTOMER_ID||!e.NAVER_API_KEY||!e.NAVER_SECRET_KEY)throw new Error("네이버 광고 연결이 필요합니다. 연결 안내를 확인하세요.");
 const ts=Date.now().toString();const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(e.NAVER_SECRET_KEY),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`${ts}.${method}.${path.split("?")[0]}`));const signature=btoa(String.fromCharCode(...new Uint8Array(sig)));
 const r=await fetch(`https://api.searchad.naver.com${path}`,{method,headers:{"Content-Type":"application/json","X-Timestamp":ts,"X-API-KEY":e.NAVER_API_KEY,"X-Customer":e.NAVER_CUSTOMER_ID,"X-Signature":signature},...(body?{body:JSON.stringify(body)}:{})});
 if(!r.ok)throw new Error(`네이버 API 요청 실패 (${r.status}). 연결 정보와 권한을 확인하세요.`);return r.json() as Promise<any>;
}
export async function GET(){try{const row=await db().prepare("SELECT data FROM bid_states WHERE id = ?").bind("main").first();const logs=await db().prepare("SELECT data FROM bid_logs ORDER BY created DESC LIMIT 100").all();const ranks=await db().prepare("SELECT data FROM bid_states WHERE id LIKE 'rank:%'").all();const worker=await db().prepare("SELECT data FROM bid_states WHERE id=?").bind("rank-worker").first();const auto=await db().prepare("SELECT (data::jsonb #- '{checkpoint,observations}' - 'resumeSignature')::text AS data FROM bid_states WHERE id=?").bind("auto").first();const autoWorker=await db().prepare("SELECT data FROM bid_states WHERE id=?").bind("auto-worker").first();const jobs=await db().prepare("SELECT (data::jsonb #- '{checkpoint,observations}' - 'resumeSignature')::text AS data FROM bid_states WHERE id LIKE 'auto-job:%'").all();return Response.json({jobs:jobs.results.map((r:any)=>publicJob(JSON.parse(r.data))),auto:auto?publicJob(JSON.parse(auto.data)):null,autoWorker:autoWorker?JSON.parse(autoWorker.data):null,ranks:ranks.results.map((r:any)=>JSON.parse(r.data)),worker:worker?JSON.parse(worker.data):null,connected:await credentials().then(Boolean).catch(()=>false),state:row?JSON.parse(row.data):null,logs:logs.results.map((r:any)=>JSON.parse(r.data))})}catch(err){return Response.json({error:(err as Error).message},{status:503})}}
export async function POST(req:Request){try{return await withManagementLock(async transaction=>{const db=()=>transaction;const naver=async(method:string,path:string,body?:unknown,supplied?:Credentials)=>naverRequest(method,path,body,supplied??await credentials(db)??undefined);
 const origin=req.headers.get("origin");if(origin&&new URL(origin).host!==req.headers.get("host"))return Response.json({error:"다른 사이트에서 보낸 요청은 허용되지 않습니다."},{status:403});
 const b=await req.json() as any;
 if(b.action==="auto-start"){
 const access=await db().prepare("SELECT data FROM bid_states WHERE id=?").bind("search-access").first();const a=access?JSON.parse(access.data):null;
 if(a?.state==="blocked"&&a.retryAt>Date.now())throw Error("네이버 검색 접근 거부(403)로 조회를 쉬고 있습니다. 재확인 가능 시각: "+new Date(a.retryAt).toLocaleTimeString("ko-KR",{timeZone:"Asia/Seoul"}));
 const saved=await db().prepare("SELECT data FROM bid_states WHERE id=?").bind("main").first();
 const worker=await db().prepare("SELECT data FROM bid_states WHERE id=?").bind("auto-worker").first();const w=worker?JSON.parse(worker.data):null;
 if(!w||w.state!=="online"||!Number.isFinite(Date.parse(w.updatedAt))||Date.now()-Date.parse(w.updatedAt)>90000)throw Error("VPS 자동입찰 서비스를 먼저 실행하세요. 서버 연결이 확인되지 않았습니다.");
 if(w.multiGroup!==true)throw Error("여러 그룹 실행을 위해 VPS 코드를 업데이트하고 작업기를 재시작하세요.");
 if(w.strategy!=="cost")throw Error("VPS 코드를 업데이트하고 작업기를 재시작하세요. 자동 절감 기능 준비가 필요합니다.");
 if(!await credentials(db))throw Error("네이버 연결 정보를 먼저 저장하세요.");
 const savedState=saved?JSON.parse(saved.data):null;
 let job:any={...makeAutoJob(savedState,Array.isArray(b.rows)?b.rows.map((r:any)=>r.id):[],b.device,b.waitSeconds,crypto.randomUUID()),group:b.group,groupName:savedState.rows.find((r:any)=>groupKey(r)===b.group)?.group,lowestRank:b.lowestRank??null,strategy:b.lowestRank===null?"increase":"cost"};
 const priorRow=await db().prepare("SELECT data FROM bid_states WHERE id=?").bind(autoJobKey(b.group)).first();const prior=priorRow?JSON.parse(priorRow.data):null;
 if(b.startMode!==undefined&&!['restart','resume'].includes(b.startMode))throw Error('실행 방식을 확인하세요.');
 if(b.startMode==='resume'){
  if(!w.resumeMode)throw Error('이어서 실행하려면 VPS 코드를 업데이트하고 재시작하세요.');
  if(prior?.jobId!==b.previousJobId)throw Error('작업 상태가 변경되었습니다. 새로고침 후 다시 선택하세요.');
  const records=await db().prepare("SELECT data FROM bid_states WHERE id LIKE 'bid-attempt:%' AND data::jsonb->>'jobId'=?").bind(prior.jobId).all();
  const signature=resumeSignature(savedState.rows,job);const checkpoint=resumeCheckpoint(prior,signature,records.results.map((r:any)=>JSON.parse(r.data)));
  job={...job,startMode:'resume',checkpoint,resumeSignature:signature,cycle:prior.cycle??0,completed:checkpoint.nextObserve,total:job.ids.length,nextCycleAt:prior.nextCycleAt??null,resumedFrom:prior.jobId};
 }else job={...job,startMode:'restart',resumeSignature:resumeSignature(savedState.rows,job)};
 assertGroupSelection(savedState.rows,job.ids,b.group);
 if(b.lowestRank!==undefined&&b.lowestRank!==null&&(!Number.isInteger(b.lowestRank)||b.lowestRank<1||b.lowestRank>5||job.ids.some((id:string)=>savedState.rows.find((r:any)=>r.id===id)?.target!==b.lowestRank)))throw Error("최저가 순위와 키워드 목표 순위를 확인하세요.");
 if(b.lowestRank!==undefined&&!w.lowestMode)throw Error("최저가 모드 사용을 위해 VPS 코드를 업데이트하고 재시작하세요.");
 const existingJobs=await db().prepare("SELECT data FROM bid_states WHERE id='auto' OR id LIKE 'auto-job:%'").all();
 const active=existingJobs.results.map((r:any)=>JSON.parse(r.data)).filter((j:any)=>activeAutoStates.includes(j.state));
 if(active.some((j:any)=>j.ids?.some((id:string)=>job.ids.includes(id))))throw Error("이 광고그룹의 키워드는 이미 실행 중입니다. PC와 모바일에서 같은 키워드를 중복 실행할 수 없습니다.");
 const result=await db().prepare("INSERT INTO bid_states(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE bid_states.data::jsonb->>'state' NOT IN ('queued','running','stop_requested')").bind(autoJobKey(b.group),JSON.stringify(job)).run();
 if(!result.rowCount)throw Error("이미 실행 중입니다. 중지 후 다시 실행하세요.");return Response.json({...publicJob(job),message:"실행 요청을 저장했습니다. VPS에서 전체 순위 조회를 시작합니다."});}
 if(b.action==="auto-stop"){
 const key=autoJobKey(String(b.group??''));
 await db().prepare("UPDATE bid_states SET data=(data::jsonb || '{\"state\":\"stop_requested\",\"message\":\"중지 요청 확인 중\"}'::jsonb)::text WHERE (id=? OR (id='auto' AND data::jsonb->>'group'=?)) AND data::jsonb->>'state' IN ('queued','running')").bind(key,b.group).run();return Response.json({state:"stop_requested",message:"선택한 광고그룹의 중지를 요청했습니다. 다른 그룹은 계속 실행됩니다."});}
 const jobRecords=await db().prepare("SELECT data FROM bid_states WHERE id='auto' OR id LIKE 'auto-job:%'").all();
 const activeJobs=jobRecords.results.map((r:any)=>JSON.parse(r.data)).filter((j:any)=>activeAutoStates.includes(j.state));
 if(activeJobs.length&&['sync','apply','connect'].includes(b.action))throw Error("동기화·수동 입찰·계정 연결 변경은 실행 중인 모든 그룹을 중지한 뒤 진행하세요.");
 if(b.action==='save'&&activeJobs.some((j:any)=>j.group===b.group))throw Error('선택한 그룹을 중지한 뒤 설정을 변경하세요.');
 if(b.action==="connect"){const c:Credentials={NAVER_CUSTOMER_ID:String(b.customerId??"").trim(),NAVER_API_KEY:String(b.apiKey??"").trim(),NAVER_SECRET_KEY:String(b.secretKey??"").trim()};if(!/^\d+$/.test(c.NAVER_CUSTOMER_ID)||!c.NAVER_API_KEY||!c.NAVER_SECRET_KEY||c.NAVER_API_KEY.length>1000||c.NAVER_SECRET_KEY.length>1000)throw Error("Customer ID와 API 정보를 확인하세요.");const campaigns=await naver("GET","/ncc/campaigns",undefined,c);await db().prepare("INSERT INTO bid_states (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind("credentials",encryptCredentials(c)).run();return Response.json({ok:true,campaignCount:Array.isArray(campaigns)?campaigns.length:0})}

 if(b.action==="save"){
 if(!Array.isArray(b.rows)||b.rows.length>5000||new Set(b.rows.map((r:any)=>r.id)).size!==b.rows.length)throw Error('키워드 목록이 올바르지 않습니다.');
 const previous=await db().prepare("SELECT data FROM bid_states WHERE id='main'").first();const state=previous?JSON.parse(previous.data):{rows:[],groups:[],mode:b.mode};
 const scoped=typeof b.group==='string'&&b.group.length>0;
 if(scoped&&activeJobs.some((j:any)=>j.ids?.some((id:string)=>b.rows.some((r:any)=>r.id===id))))throw Error('현재 그룹을 중지한 뒤 설정을 변경하세요.');
 if(activeJobs.length&&!scoped)throw Error('다른 그룹이 실행 중입니다. 그룹별로 저장하세요.');
 if(scoped){if(b.rows.length)assertGroupSelection(state.rows,b.rows.map((r:any)=>r.id),b.group);else if(!(state.groups??[]).some((g:any)=>g.id===b.group))throw Error('광고그룹을 확인하세요.');if(b.rows.length!==state.rows.filter((r:any)=>groupKey(r)===b.group).length)throw Error('현재 그룹의 전체 설정을 저장하세요.');}
 const host=b.siteHost?normalizeAdHost(String(b.siteHost)):null;
 if(b.siteHost&&!host)throw Error('광고 사이트 URL을 확인하세요.');
 const incoming=new Map<string,any>(b.rows.map((r:any)=>[r.id,r]));
 for(const r of b.rows)if(!Number.isInteger(r.target)||r.target<1||r.target>10||!Number.isInteger(r.min)||!Number.isInteger(r.max)||r.min<70||r.max>100000||r.min>r.max||r.min%10||r.max%10||!Number.isInteger(r.step)||r.step<10||r.step>100||r.step%10)throw Error('목표 순위와 입찰 범위를 확인하세요.');
 if(state.mode==='live'&&b.mode!=='live')throw Error('실제 계정 모드를 변경할 수 없습니다.');
 const updated=scoped?state.rows.map((r:any)=>{const n=incoming.get(r.id);return n?{...r,min:n.min,max:n.max,target:n.target,step:n.step,selected:!!n.selected,enabled:!!n.enabled,siteHost:host??siteForRow(r)}:r;}):b.rows.map((r:any)=>({...r,siteHost:siteForRow(r)}));
 const groups=(state.groups??[]).map((g:any)=>g.id===b.group?{...g,siteHost:host??g.siteHost}:g);
 const groupSettings={...state.groupSettings,...(scoped?{[b.group]:{device:b.device==='PC'?'PC':'MOBILE',waitSeconds:b.waitSeconds??state.groupSettings?.[b.group]?.waitSeconds??180,lowestRank:b.lowestRank===undefined?(state.groupSettings?.[b.group]?.lowestRank??3):b.lowestRank}}:{})};
 // Lock the main row and merge settings in SQL, preserving live worker bid updates.
 const settings=updated.map((r:any)=>{const {bid,...rest}=r;return rest;});
 if(scoped)await db().prepare("UPDATE bid_states SET data=jsonb_set(data::jsonb || ?::jsonb,'{rows}',(SELECT jsonb_agg(e.value || COALESCE((SELECT value FROM jsonb_array_elements(?::jsonb) n(value) WHERE n.value->>'id'=e.value->>'id'),'{}'::jsonb) ORDER BY e.ordinality) FROM jsonb_array_elements(data::jsonb->'rows') WITH ORDINALITY e))::text WHERE id='main'").bind(JSON.stringify({groups,groupSettings,device:b.device==='PC'?'PC':'MOBILE'}),JSON.stringify(settings)).run();
 else await db().prepare("INSERT INTO bid_states(id,data) VALUES('main',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify({...state,rows:updated,mode:b.mode,device:b.device==='PC'?'PC':'MOBILE'})).run();
 return Response.json({ok:true});}
 if(b.action==="sync"){
 const previous=await db().prepare("SELECT data FROM bid_states WHERE id='main'").first();const old=previous?JSON.parse(previous.data):{};
 const campaigns=await naver('GET','/ncc/campaigns');const adgroups=await naver('GET','/ncc/adgroups');const groups=[];const rows=[];
 for(const g of adgroups){if(g.adgroupType!=='WEB_SITE')continue;
 const campaign=campaigns.find((c:any)=>c.nccCampaignId===g.nccCampaignId);const previousGroup=old.groups?.find((x:any)=>x.id===g.nccAdgroupId);
 const host=previousGroup?.siteHost??(adgroups.filter((x:any)=>x.name===g.name).length===1?siteForGroup(g.name):null);groups.push({id:g.nccAdgroupId,name:g.name,campaignId:g.nccCampaignId,campaignName:campaign?.name??g.nccCampaignId,siteHost:host});
 const keywords=await naver('GET',`/ncc/keywords?nccAdgroupId=${encodeURIComponent(g.nccAdgroupId)}`);
 for(const k of keywords){const saved=old.rows?.find((r:any)=>r.id===k.nccKeywordId);rows.push({...saved,id:k.nccKeywordId,keyword:k.keyword,group:g.name,groupId:g.nccAdgroupId,campaignId:g.nccCampaignId,campaignName:campaign?.name??g.nccCampaignId,siteHost:host,bid:k.useGroupBidAmt?g.bidAmt:k.bidAmt,min:saved?.min??70,max:saved?.max??1500,target:saved?.target??4,step:saved?.step??10,enabled:saved?.enabled??false,selected:saved?.selected??false});}
 }
 const groupSettings={...old.groupSettings};for(const g of groups)if(!groupSettings[g.id])groupSettings[g.id]=old.groupSettings?.[g.name]??{device:old.device??'MOBILE',waitSeconds:180,lowestRank:3};
 await db().prepare("UPDATE bid_states b SET data=jsonb_build_object('context','','stable',0,'lastObservation',0,'changedAt',0,'cooldownUntil',0,'appliedBid',(r.value->>'bid')::int)::text FROM jsonb_array_elements(?::jsonb) r(value) WHERE b.id IN ('cost:PC:'||(r.value->>'id'),'cost:MOBILE:'||(r.value->>'id'))").bind(JSON.stringify(rows.map((r:any)=>({id:r.id,bid:r.bid})))).run();
 const state={...old,campaigns:campaigns.map((c:any)=>({id:c.nccCampaignId,name:c.name})),rows,groups,groupSettings,mode:'live',device:old.device??'MOBILE'};
 await db().prepare("INSERT INTO bid_states(id,data) VALUES('main',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(state)).run();
 return Response.json({rows,groups,state});}
 if(b.action==="estimate"){if(!Array.isArray(b.rows)||b.rows.length>50)throw new Error("한 번에 50개 이하를 선택하세요.");const items=await naver("POST","/estimate/average-position-bid/keyword",{device:b.device==="PC"?"PC":"MOBILE",items:b.rows.map((r:any)=>({key:r.keyword,position:r.target}))});return Response.json({items:items.estimate??items})}
 if(b.action==="apply"){const saved=await db().prepare("SELECT data FROM bid_states WHERE id=?").bind("main").first();const state=saved?JSON.parse(saved.data):null;if(!state||state.mode!=="live")throw new Error("실제 계정의 키워드를 먼저 동기화하고 저장하세요.");if(!Array.isArray(b.changes)||b.changes.length>50)throw new Error("한 번에 50개 이하를 적용하세요.");const results=[];
 for(const c of b.changes){const row=state.rows.find((r:any)=>r.id===c.id);if(!row||!Number.isInteger(c.bid)||c.bid<row.min||c.bid>row.max||c.bid%10)throw new Error("허용 범위를 벗어난 입찰가입니다.");const current=await naver("GET",`/ncc/keywords/${encodeURIComponent(c.id)}`);const before=current.bidAmt;await naver("PUT","/ncc/keywords?fields=bidAmt",[{...current,bidAmt:c.bid,useGroupBidAmt:false}]);const log={keyword:row.keyword,before,after:c.bid,time:new Date().toISOString(),kind:"실제 적용"};await db().prepare("INSERT INTO bid_logs (id,data,created) VALUES (?,?,?)").bind(crypto.randomUUID(),JSON.stringify(log),log.time).run();results.push(log)}return Response.json({results})}
 throw new Error("지원하지 않는 요청입니다.");
 });}catch(err){return Response.json({error:(err as Error).message},{status:400})}}
