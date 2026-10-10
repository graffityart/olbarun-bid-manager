export function resolveGroup<T extends {group:string}>(rows:T[], requested:string):string {
 const names=[...new Set(rows.map(r=>r.group))];
 if(names.includes(requested))return requested;
 return names.includes('파워링크#1_광고그룹#1')?'파워링크#1_광고그룹#1':names[0]??'';
}
export function groupRows<T extends {group:string}>(rows:T[], group:string):T[]{return rows.filter(r=>r.group===group);}

export function assertGroupSelection(rows:{id:string;group:string}[],ids:string[],group:unknown):void {
 const byId=new Map(rows.map(r=>[r.id,r]));
 if(typeof group!=='string'||!group||!ids.length||ids.some(id=>byId.get(id)?.group!==group))throw Error('선택한 광고그룹의 키워드만 실행하세요.');
}
