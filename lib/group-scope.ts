type GroupRow={group:string;groupId?:string};
export function groupKey(row:GroupRow):string{return row.groupId||row.group;}
export function resolveGroup<T extends GroupRow>(rows:T[],requested:string):string {
 const keys=[...new Set(rows.map(groupKey))];
 if(keys.includes(requested))return requested;
 return rows.find(r=>r.group==='파워링크#1_광고그룹#1')?groupKey(rows.find(r=>r.group==='파워링크#1_광고그룹#1')!):keys[0]??'';
}
export function groupRows<T extends GroupRow>(rows:T[],group:string):T[]{return rows.filter(r=>groupKey(r)===group);}
export function assertGroupSelection(rows:({id:string}&GroupRow)[],ids:string[],group:unknown):void {
 const byId=new Map(rows.map(r=>[r.id,r]));
 if(typeof group!=='string'||!group||!ids.length||ids.some(id=>!byId.has(id)||groupKey(byId.get(id)!)!==group))throw Error('선택한 광고그룹의 키워드만 실행하세요.');
}
export function autoJobKey(group:string):string{if(!group||group.length>300)throw Error('Invalid group');return 'auto-job:'+group;}
