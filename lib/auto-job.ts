import {siteForGroup} from './ad-sites.ts';
export const activeAutoStates = ['queued','running','stop_requested'];
export function makeAutoJob(state:any, ids:string[], device:string, waitSeconds:number, jobId:string) {
  if(state?.mode!=='live'||!['PC','MOBILE'].includes(device)||state.device!==device||!Number.isInteger(waitSeconds)||waitSeconds<120||waitSeconds>3600||!Array.isArray(ids)||!ids.length||ids.length>5000||new Set(ids).size!==ids.length) throw Error('실제 키워드, PC/모바일 및 대기시간 120~3600초를 확인하세요.');
  const rows=ids.map(id=>state.rows?.find((r:any)=>r.id===id));
  if(rows.some(r=>!r||!siteForGroup(r.group)||!Number.isInteger(r.target)||r.target<1||r.target>10||!Number.isInteger(r.bid)||r.bid<70||r.bid%10||!Number.isInteger(r.max)||r.max<70||r.max>100000||r.max%10)) throw Error('키워드의 그룹, 목표 순위와 최대 입찰가를 확인하세요.');
  return {jobId,state:'queued',ids,device,waitSeconds,step:10,cycle:0,createdAt:new Date().toISOString(),message:'VPS 실행 대기'};
}
