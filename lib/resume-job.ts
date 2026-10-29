import {validPriorityQueue} from './priority-rotation.ts';
import {groupKey} from './group-scope.ts';
import {siteForRow} from './ad-sites.ts';
export function resumeSignature(rows:any[],job:any):string {
 return JSON.stringify([job.group,job.device,job.waitSeconds,job.strategy,job.lowestRank??null,job.policyVersion??null,job.scheduleVersion??null,job.ids.map((id:string)=>{
  const r=rows.find(x=>x.id===id);if(!r)throw Error('키워드 목록이 변경되었습니다. 처음부터 다시 실행하세요.');
  return [r.id,groupKey(r),r.keyword,siteForRow(r),r.target,r.min??70,r.max,r.step??10];
 })]);
}
export function resumeCheckpoint(previous:any,signature:string,attempts:any[]){
 if(previous?.state!=='stopped'||!previous.checkpoint||previous.resumeSignature!==signature)throw Error('이어갈 작업이 없거나 설정이 변경되었습니다. 처음부터 다시 실행하세요.');
 const checkpoint=structuredClone(previous.checkpoint);
 if(checkpoint.version===2){
  const n=previous.ids.length;
  if(checkpoint.singlePass&&(!Array.isArray(checkpoint.order)||checkpoint.order.length!==n||new Set(checkpoint.order).size!==n||checkpoint.order.some((id:string)=>!previous.ids.includes(id))))throw Error('저장된 우선 조회 순서를 확인할 수 없습니다. 처음부터 다시 실행하세요.');
  if(!['manage','complete'].includes(checkpoint.phase)||JSON.stringify(checkpoint.ids)!==JSON.stringify(previous.ids)||checkpoint.device!==previous.device||!validPriorityQueue(previous.ids,checkpoint.queue)||!Number.isInteger(checkpoint.nextManage)||checkpoint.nextManage<0||checkpoint.nextManage>n||!Number.isInteger(checkpoint.nextObserve)||checkpoint.nextObserve<checkpoint.nextManage||checkpoint.nextObserve>Math.min(n,checkpoint.nextManage+1)||!Number.isInteger(checkpoint.changes)||checkpoint.changes<0||checkpoint.changes>checkpoint.nextManage||(checkpoint.phase==='complete'&&checkpoint.nextManage!==n)||(checkpoint.pendingManageId&&(!previous.ids.includes(checkpoint.pendingManageId)||!Number.isFinite(checkpoint.pendingStartedAt))))throw Error('저장된 진행 정보를 확인할 수 없습니다. 처음부터 다시 실행하세요.');
  if(attempts.some(a=>a.state==='pending'))throw Error('확정되지 않은 입찰 요청이 있습니다. 네이버 입찰가를 확인하고 동기화한 뒤 처음부터 실행하세요.');
  if(checkpoint.pendingManageId){
   const confirmed=attempts.some(a=>a.keywordId===checkpoint.pendingManageId&&Date.parse(a.time)>=checkpoint.pendingStartedAt&&a.state==='confirmed');
   if(confirmed){checkpoint.nextManage++;checkpoint.changes++;}
   checkpoint.nextObserve=checkpoint.nextManage;checkpoint.observations={};delete checkpoint.pendingManageId;delete checkpoint.pendingStartedAt;
  }
  return checkpoint;
 }

 if(checkpoint.version!==1||!['observe','manage','complete'].includes(checkpoint.phase)||!Array.isArray(checkpoint.ids)||JSON.stringify(checkpoint.ids)!==JSON.stringify(previous.ids)||checkpoint.device!==previous.device)throw Error('저장된 진행 정보를 확인할 수 없습니다. 처음부터 다시 실행하세요.');
 if(!Number.isInteger(checkpoint.nextObserve)||checkpoint.nextObserve<0||checkpoint.nextObserve>previous.ids.length||!Number.isInteger(checkpoint.nextManage)||checkpoint.nextManage<0||checkpoint.nextManage>previous.ids.length||!Number.isInteger(checkpoint.changes)||checkpoint.changes<0||!checkpoint.observations||typeof checkpoint.observations!=='object'||(checkpoint.phase!=='observe'&&checkpoint.nextObserve!==previous.ids.length)||(checkpoint.phase==='complete'&&checkpoint.nextManage!==previous.ids.length)||(checkpoint.pendingManageId&&checkpoint.pendingManageId!==previous.ids[checkpoint.nextManage]))throw Error('저장된 진행 정보가 올바르지 않습니다. 처음부터 다시 실행하세요.');
 // A request with an unconfirmed external write must never be replayed.
 if(attempts.some(a=>a.state==='pending'))throw Error('확정되지 않은 입찰 요청이 있습니다. 네이버 입찰가를 확인하고 동기화한 뒤 처음부터 실행하세요.');
 if(checkpoint.pendingManageId){
  const relevant=attempts.filter(a=>a.keywordId===checkpoint.pendingManageId&&Date.parse(a.time)>=checkpoint.pendingStartedAt);
  if(relevant.some(a=>a.state==='confirmed')){checkpoint.nextManage++;checkpoint.changes++;}
  delete checkpoint.pendingManageId;delete checkpoint.pendingStartedAt;
 }
 return checkpoint;
}
export function publicJob(job:any){
 if(!job)return null;const {resumeSignature,...result}=job;
 if(job.checkpoint){const {observations,queue,order,ids,...summary}=job.checkpoint;result.checkpoint={...summary,total:ids?.length??job.ids?.length??0};}
 return result;
}
