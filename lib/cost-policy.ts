import {increaseForRank} from './adaptive-bid.ts';
export type CostState = {
 context: string; stable: number; lastObservation: number; changedAt: number;
 appliedBid?: number; goodBid?: number; failedBid?: number;
 pending?: {before:number; after:number}; cooldownUntil:number; fine?:boolean;
};
export type CostAction = 'hold'|'increase'|'reduce'|'restore';
export function costDecision(input:{bid:number;min:number;max:number;target:number;rank:number|null;source:string|null;device:string;group:string;observedAt:number;now:number;waitSeconds:number;stableChecks?:number;exactRank?:boolean;reductionAmount?:number}, previous?:CostState|null) {
 const x=input, context=JSON.stringify([x.device,x.source,x.group,x.target,x.min,x.max,x.stableChecks??2,!!x.exactRank,x.reductionAmount??10]);
 let s:CostState=previous?.context===context?{...previous}: {context,stable:0,lastObservation:previous?.lastObservation??0,changedAt:previous?.changedAt??0,appliedBid:previous?.appliedBid,pending:previous?.pending,goodBid:previous?.goodBid,failedBid:previous?.failedBid,fine:previous?.fine,cooldownUntil:previous?.cooldownUntil??0};
 const hold=(reason:string)=>({action:'hold' as CostAction,next:x.bid,state:s,reason});
 if(x.reductionAmount!==undefined&&(!Number.isInteger(x.reductionAmount)||x.reductionAmount<10||x.reductionAmount>100||x.reductionAmount%10))return hold('가감액 단위 확인 필요');
 if(!Number.isInteger(x.bid)||x.bid<70||x.bid%10||!Number.isInteger(x.min)||x.min<70||x.min%10||x.min>x.max) return hold('입찰 범위 확인 필요');
 if(x.bid>x.max) return hold('실제 금액이 최대 입찰가 초과 · 금액 유지');
 if(x.bid<x.min) return hold('현재 금액이 최소 입찰가 미만 · 설정 확인');
 if(previous?.appliedBid!==undefined&&previous.appliedBid!==x.bid){s={...previous};return hold('이전 변경 금액 재확인 필요 · 중지 후 동기화');}
 if(!Number.isInteger(x.rank)||x.rank!<1||!['MAIN','MORE'].includes(x.source??'')||!Number.isFinite(x.observedAt)||x.observedAt>x.now||x.now-x.observedAt>60000){s.stable=0;return hold('순위 미확인 · 금액 유지');}
 if(x.observedAt<s.changedAt+x.waitSeconds*1000) return hold('입찰 반영 확인 대기');
 if(x.observedAt<=s.lastObservation) return hold('새 순위 조회 대기');
 s.lastObservation=x.observedAt;
 const outside=x.source!=='MAIN'||x.rank!>x.target;
 if(s.pending){
  if(outside){
   s.failedBid=s.pending.after;const next=s.pending.before;
   if(next>x.max) return hold('복구 금액이 최대 입찰가 초과');
   return {action:'restore' as CostAction,next,state:s,reason:'감액 후 목표 이탈 · 이전 금액 복구'};
  }
  s.goodBid=x.bid;s.pending=undefined;s.stable=0;
 }
 if(outside){s.stable=0;s.goodBid=undefined;s.failedBid=undefined;
  const next=increaseForRank(x.bid,x.max,x.target,x.rank,x.source);
  return next===x.bid?hold('최대 입찰가 · 금액 유지'):{action:'increase' as CostAction,next,state:s,reason:`${x.source==='MORE'?'더보기 확인':'상단 목표 밖'} · ${next-x.bid}원 증액`};
 }
 s.goodBid=x.bid;s.stable++;
 const checks=x.stableChecks??2;
 if(x.exactRank&&x.rank!==x.target){s.stable=0;return hold('설정 순위 도달 대기 · 금액 유지');}
 if(s.stable<checks) return hold(`목표 유지 확인 ${s.stable}/${checks}`);
 if(x.now<s.cooldownUntil) return hold('감액 재시험 대기 · 순위 감시 중');
 if(x.bid<=x.min) return hold('최소 입찰가 · 순위 감시 중');
 const next=Math.max(x.min,x.bid-(x.reductionAmount??10));
 return {action:'reduce' as CostAction,next,state:s,reason:'목표 유지 · 감액 시험'};
}
export function costApplied(state:CostState,action:CostAction,before:number,after:number,now:number):CostState {
 const s={...state,appliedBid:after,changedAt:now,stable:0};
 if(action==='reduce')s.pending={before,after};
 if(action==='restore'){s.pending=undefined;s.goodBid=after;s.fine=true;s.cooldownUntil=now+30*60000;}
 return s;
}
