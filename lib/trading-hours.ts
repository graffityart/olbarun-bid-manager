// The VPS may run in UTC. All business dates and boundaries are Korean time.
const KST=9*60*60*1000,DAY=86400000;
export const TRADING_SCHEDULE='kst-mon-sat-0530-2000-v1';
export function tradingWindow(now:number){
 if(!Number.isFinite(now))throw Error('Invalid schedule time');
 const local=new Date(now+KST),weekday=local.getUTCDay(),minute=local.getUTCHours()*60+local.getUTCMinutes();
 const dayKey=local.toISOString().slice(0,10),midnight=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-KST;
 const allowed=weekday!==0&&minute>=330&&minute<1200;
 let nextStart=midnight+330*60000;
 if(weekday===0||now>=midnight+1200*60000){nextStart+=DAY;while(new Date(nextStart+KST).getUTCDay()===0)nextStart+=DAY;}
 return {dayKey,allowed,nextStart:allowed?now:nextStart,waitingForExposure:weekday!==0&&minute>=300&&minute<330,endsAt:midnight+1200*60000};
}
export function openingOrder(rows:{id:string;target:number}[],ranks:any[]):string[]{
 const byId=new Map(ranks.map(r=>[r.id,r]));
 const priority=(row:{id:string;target:number})=>{const r=byId.get(row.id);return r?.status==='visible'&&Number.isInteger(r.rank)&&r.rank>0?(r.source==='MORE'||r.source==='MAIN'&&r.rank>row.target?0:r.source==='MAIN'?2:1):1;};
 return rows.map((r,i)=>({r,i,p:priority(r)})).sort((a,b)=>a.p-b.p||a.i-b.i).map(x=>x.r.id);
}
// Keep reversal of an already pending reduction, but make no new reductions
// during the first two complete daily passes. Stable checks restart in pass 3.
export function openingDecision<T extends {action:string;next:number;state:{stable:number};reason:string}>(decision:T,bid:number,round:number):T {
 if(round>2||decision.action==='restore'||decision.action==='increase')return decision;
 return {...decision,action:'hold',next:bid,state:{...decision.state,stable:0},reason:decision.action==='reduce'?`당일 ${round}회차 · 목표 이내 감액 보류`:decision.reason};
}

export function dailyRunState(date:string,completed:number,job:{runDate?:string;cycle?:number},checkpoint:any){
 const rounds=Number.isInteger(completed)&&completed>=0?completed:0;
 if(job.runDate!==date||!checkpoint)return {cycle:rounds,resume:null};
 const cycle=Number.isInteger(job.cycle)&&job.cycle!>0?job.cycle!:1;
 return checkpoint.phase==='complete'?{cycle:Math.max(rounds,cycle),resume:null}:{cycle,resume:checkpoint};
}
