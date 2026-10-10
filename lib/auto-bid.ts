// Validate again against fresh UI settings and effective Naver bid before any PUT.
export function assertAutoBid(row:any, original:any, kw:any, group:any, expected:number, next:number, observation:any, device:string, now:number) {
 if(!row||row.bid!==expected||row.max<next||row.target!==original.target||row.group!==original.group||row.keyword!==original.keyword||next!==expected+10)throw Error('Settings changed');
 if(observation?.status!=='visible'||observation.device!==device||!Number.isInteger(observation.rank)||observation.rank<=row.target||!Number.isFinite(Date.parse(observation.observedAt))||now-Date.parse(observation.observedAt)>60000||Date.parse(observation.observedAt)>now)throw Error('Rank is not fresh or outside target');
 const effective=kw.useGroupBidAmt?group.bidAmt:kw.bidAmt;
 if(kw.nccKeywordId!==row.id||kw.keyword!==row.keyword||kw.nccAdgroupId!==group.nccAdgroupId||group.name!==row.group||group.adgroupType!=='WEB_SITE')throw Error('Naver keyword/group identity changed');
 if(kw.userLock||group.userLock)throw Error('Naver keyword or group is paused');
 if(kw.status!=='ELIGIBLE'||group.status!=='ELIGIBLE')throw Error('Naver keyword or group is not eligible');
 if(effective!==expected)throw Error(`Naver effective bid differs: saved=${expected}, actual=${effective}`);
}

// A stale saved bid must not turn an actual bid above the cap into a write.
export function cappedActualBid(row:any, kw:any, group:any):number|null {
 if(kw.nccKeywordId!==row.id||kw.keyword!==row.keyword||kw.nccAdgroupId!==group.nccAdgroupId||group.name!==row.group||group.adgroupType!=='WEB_SITE')throw Error('Naver keyword/group identity changed');
 const bid=kw.useGroupBidAmt?group.bidAmt:kw.bidAmt;
 if(!Number.isInteger(bid)||bid<70||bid%10)throw Error('Invalid Naver effective bid');
 return bid+10>row.max?bid:null;
}

export function assertCostBid(row:any,original:any,kw:any,group:any,expected:number,next:number,observation:any,device:string,now:number,action:string) {
 const increase=action==='increase', reduce=action==='reduce', restore=action==='restore';
 if(!row||row.target!==original.target||row.max!==original.max||row.min!==original.min||row.group!==original.group||row.keyword!==original.keyword||row.bid!==expected||!Number.isInteger(next)||next%10||next<Math.max(70,row.min??70)||next>row.max||(!increase&&!reduce&&!restore)||(increase&&next!==expected+10)||(reduce&&next>=expected)||(restore&&next<=expected))throw Error('Settings changed');
 if(observation?.status!=='visible'||observation.device!==device||!['MAIN','MORE'].includes(observation.source)||!Number.isInteger(observation.rank)||observation.rank<1||!Number.isFinite(Date.parse(observation.observedAt))||now-Date.parse(observation.observedAt)>60000||Date.parse(observation.observedAt)>now||(reduce?observation.rank>row.target:observation.rank<=row.target))throw Error('Rank is not fresh or outside target');
 cappedActualBid(row,kw,group);
 if(kw.userLock||group.userLock)throw Error('Naver keyword or group is paused');
 if(kw.status!=='ELIGIBLE'||group.status!=='ELIGIBLE')throw Error('Naver keyword or group is not eligible');
 if((kw.useGroupBidAmt?group.bidAmt:kw.bidAmt)!==expected)throw Error('Settings changed');
}
