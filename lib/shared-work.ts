// FIFO queue shared by every advertising group in this VPS process.
export function serialWork(){
 let tail:Promise<unknown>=Promise.resolve();
 return function run<T>(task:()=>Promise<T>):Promise<T>{
  const next=tail.then(task);tail=next.catch(()=>{});return next;
 };
}
export function searchDelay(lastStarted:number,now:number,interval=15000):number{return Math.max(0,lastStarted+interval-now);}
export function jobsOverlap(a:{ids:string[]},b:{ids:string[]}):boolean {const ids=new Set(a.ids);return b.ids.some(id=>ids.has(id));}
