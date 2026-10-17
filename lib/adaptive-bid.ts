export const BID_POLICY = 'adaptive-300-v1';
// More ranks are not comparable with main-search ranks.
export function increaseForRank(bid:number,max:number,target:number,rank:number|null,source:string|null):number {
 if(!Number.isInteger(bid)||!Number.isInteger(max)||bid<70||max>100000||bid%10||max%10||bid>=max||!Number.isInteger(target)||target<1||target>10||!Number.isInteger(rank)||rank!<1||!['MAIN','MORE'].includes(source??''))return bid;
 if(source==='MAIN'&&rank!<=target)return bid;
 const step=source==='MORE'||rank!-target>=4?300:50;
 return Math.min(max,bid+step);
}
