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
