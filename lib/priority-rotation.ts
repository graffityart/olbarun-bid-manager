import type {RotationRow,RankResult,RotationPorts} from './rotation.ts';
export type QueueEntry={dueAt:number;priority:0|1|2;lastRun:number};
export type PriorityQueue={entries:Record<string,QueueEntry>;urgentBurst:number;turn:number};
export type PriorityCheckpoint={version:2;ids:string[];device:'PC'|'MOBILE';phase:'manage'|'complete';nextObserve:number;nextManage:number;changes:number;observations:Record<string,RankResult>;queue:PriorityQueue;singlePass?:boolean;order?:string[];pendingManageId?:string;pendingStartedAt?:number};
type Ports=Omit<RotationPorts,'resume'|'checkpoint'> & {resume?:PriorityCheckpoint;queue?:PriorityQueue;singlePass?:boolean;order?:string[];checkpoint?(value:PriorityCheckpoint):Promise<void>};
export function nextScheduled(ids:string[],queue:PriorityQueue,now:number):string|null {
 const ready=ids.filter(id=>queue.entries[id].dueAt<=now);
 const oldest=(list:string[])=>list.sort((a,b)=>queue.entries[a].lastRun-queue.entries[b].lastRun||ids.indexOf(a)-ids.indexOf(b))[0];
 const urgent=ready.filter(id=>queue.entries[id].priority===0),background=ready.filter(id=>queue.entries[id].priority!==0);
 return (urgent.length&&(queue.urgentBurst<3||!background.length)?oldest(urgent):oldest(background))??null;
}
export function validPriorityQueue(ids:string[],q:PriorityQueue):boolean {
 return !!q&&Number.isInteger(q.urgentBurst)&&q.urgentBurst>=0&&Number.isInteger(q.turn)&&q.turn>=0&&!!q.entries&&Object.keys(q.entries).length===ids.length&&ids.every(id=>{const e=q.entries[id];return e&&Number.isFinite(e.dueAt)&&e.dueAt>=0&&[0,1,2].includes(e.priority)&&Number.isInteger(e.lastRun)&&e.lastRun>=0&&e.lastRun<=q.turn;});
}
// One bounded scheduling batch. Unlike a full scan, a keyword is managed as
// soon as it is observed; due urgent keywords can recur before the scan ends.
export async function runPriorityRotation(rows:RotationRow[],device:'PC'|'MOBILE',waitSeconds:number,ports:Ports){
 const ids=rows.map(r=>r.id),byId=new Map(rows.map(r=>[r.id,r]));
 if(!ids.length||ids.length>5000||new Set(ids).size!==ids.length||!['PC','MOBILE'].includes(device)||!Number.isInteger(waitSeconds)||waitSeconds<120||waitSeconds>3600||!ports.manage||rows.some(r=>!r.id||!Number.isInteger(r.bid)||r.bid<70||r.bid%10||!Number.isInteger(r.max)||r.max<70||r.max>100000||r.max%10||!Number.isInteger(r.target)||r.target<1||r.target>10))throw Error('Invalid priority settings');
 const queue=structuredClone(ports.resume?.queue??ports.queue??{entries:Object.fromEntries(ids.map(id=>[id,{dueAt:0,priority:1 as const,lastRun:0}])),urgentBurst:0,turn:0});
 if(!validPriorityQueue(ids,queue))throw Error('Invalid priority queue');
 const cp:PriorityCheckpoint=ports.resume?structuredClone(ports.resume):{version:2,ids,device,phase:'manage',nextObserve:0,nextManage:0,changes:0,observations:{},queue,singlePass:!!ports.singlePass,order:ports.singlePass?(ports.order??ids):undefined};cp.queue=queue;
 if(cp.singlePass&&(!Array.isArray(cp.order)||cp.order.length!==ids.length||new Set(cp.order).size!==ids.length||cp.order.some(id=>!byId.has(id))))throw Error('Invalid opening order');
 if(cp.version!==2||cp.device!==device||JSON.stringify(cp.ids)!==JSON.stringify(ids)||!['manage','complete'].includes(cp.phase)||!Number.isInteger(cp.nextManage)||cp.nextManage<0||cp.nextManage>ids.length||cp.pendingManageId)throw Error('Invalid priority checkpoint');
 const persist=async()=>ports.checkpoint?.(structuredClone(cp));
 const stop=async()=>{if(!await ports.stopped())return false;await ports.event({status:'stopped'});return true;};
 await persist();
 while(cp.nextManage<ids.length&&cp.phase!=='complete'){
  if(await stop())return {changes:cp.changes,stopped:true,queue};
  const id=cp.singlePass?cp.order![cp.nextManage]:nextScheduled(ids,queue,ports.now());
  if(!id){const due=Math.min(...ids.map(x=>queue.entries[x].dueAt));await ports.wait(Math.max(0.001,Math.min(5,(due-ports.now())/1000)));continue;}
  const row=byId.get(id)!;let observation:RankResult;
  try{observation=await ports.observe(row,device);}catch(error){if(error instanceof Error&&error.name==='SearchAccessDenied')throw error;observation={rank:null,observedAt:ports.now(),device};}
  if(await stop())return {changes:cp.changes,stopped:true,queue};
  const valid=observation.device===device&&Number.isInteger(observation.rank)&&observation.rank!>0&&Number.isFinite(observation.observedAt)&&observation.observedAt<=ports.now()&&ports.now()-observation.observedAt<=60000;
  const entry=queue.entries[id],wasUrgent=entry.priority===0;
  // Persist a conservative retry time before any external write. Resume must
  // reconcile a pending attempt before managing this keyword again.
  queue.turn++;entry.lastRun=queue.turn;entry.dueAt=ports.now()+waitSeconds*1000;entry.priority=0;
  queue.urgentBurst=wasUrgent?queue.urgentBurst+1:0;
  cp.nextObserve=cp.nextManage+1;cp.pendingManageId=id;cp.pendingStartedAt=ports.now();cp.observations={[id]:observation};await persist();
  if(await stop())return {changes:cp.changes,stopped:true,queue};
  const result=await ports.manage!(row,valid?observation:{...observation,rank:null});
  if(result.stopped)return {changes:cp.changes,stopped:true,queue};
  if(result.changed)cp.changes++;
  const source=(observation as RankResult&{source?:string}).source;
  const outside=source==='MORE'||observation.rank!>row.target;
  const urgent=result.status==='reduced'||result.status==='restored'||result.status==='increased'||(valid&&outside&&result.status!=='capped'&&result.bid<row.max);
  const unknown=!valid||result.status==='unknown';
  entry.priority=urgent?0:unknown?1:2;
  entry.dueAt=ports.now()+(urgent?waitSeconds:unknown?Math.max(waitSeconds,300):Math.max(waitSeconds,600))*1000;
  await ports.event({id,status:result.status,bid:result.bid});
  cp.nextManage++;cp.nextObserve=cp.nextManage;delete cp.pendingManageId;delete cp.pendingStartedAt;cp.observations={};await persist();
 }
 cp.phase='complete';await persist();return {changes:cp.changes,stopped:await stop(),queue};
}
