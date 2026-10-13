export type RotationRow = { id: string; bid: number; target: number; max: number };
export type RankResult = { rank: number | null; observedAt: number; device: 'PC' | 'MOBILE' };
export type RotationEvent = { id?: string; status: 'reached' | 'capped' | 'unknown' | 'increased' | 'stopped' | 'waiting' | 'reduced' | 'restored' | 'monitoring'; bid?: number };
export type RotationCheckpoint={version:1;ids:string[];device:'PC'|'MOBILE';phase:'observe'|'manage'|'complete';nextObserve:number;nextManage:number;changes:number;observations:Record<string,RankResult>;pendingManageId?:string;pendingStartedAt?:number};
export type RotationPorts = {
  resume?:RotationCheckpoint;
  checkpoint?(value:RotationCheckpoint):Promise<void>;
  deferReflectionWait?: boolean;
  now(): number;
  stopped(): Promise<boolean>;
  observe(row: RotationRow, device: 'PC' | 'MOBILE'): Promise<RankResult>;
  // Revalidate settings and the live effective bid before writing. Return the
  // actual bid when using a refreshed baseline; never retry an ambiguous write.
  apply(id: string, expectedBid: number, nextBid: number): Promise<void | boolean | {status: 'capped' | 'increased'; bid: number}>;
  manage?(row: RotationRow, observation: RankResult): Promise<{changed:boolean;stopped?:boolean;bid:number;status:RotationEvent['status']}>;
  event(event: RotationEvent): Promise<void>;
  wait(seconds: number): Promise<void>;
};

// One rotation only: the durable host schedules the next rotation after this returns.
// All ranks are collected first. Old observations are refreshed before a write.
export async function runRotation(rows: RotationRow[], device: 'PC' | 'MOBILE', waitSeconds: number, ports: RotationPorts) {
  if (!rows.length || rows.length > 5000 || new Set(rows.map(r => r.id)).size !== rows.length || !['PC', 'MOBILE'].includes(device) || !Number.isInteger(waitSeconds) || waitSeconds < 120 || waitSeconds > 3600 || rows.some(r => !r.id || !Number.isInteger(r.bid) || r.bid < 70 || r.bid % 10 || !Number.isInteger(r.max) || r.max < 70 || r.max > 100000 || r.max % 10 || !Number.isInteger(r.target) || r.target < 1 || r.target > 10)) throw Error('Invalid rotation settings');
  const initial:RotationCheckpoint={version:1,ids:rows.map(r=>r.id),device,phase:'observe',nextObserve:0,nextManage:0,changes:0,observations:{}};
  const checkpoint:RotationCheckpoint=ports.resume?structuredClone(ports.resume):initial;
  if(checkpoint.version!==1||checkpoint.device!==device||JSON.stringify(checkpoint.ids)!==JSON.stringify(initial.ids)||!['observe','manage','complete'].includes(checkpoint.phase)||!Number.isInteger(checkpoint.nextObserve)||checkpoint.nextObserve<0||checkpoint.nextObserve>rows.length||!Number.isInteger(checkpoint.nextManage)||checkpoint.nextManage<0||checkpoint.nextManage>rows.length)throw Error('Invalid checkpoint');
  const observations = new Map<string,RankResult>(Object.entries(checkpoint.observations));
  const resumedObservations=new Set(Object.keys(ports.resume?.observations??{}));
  let changes = checkpoint.changes;
  const persist=async()=>{checkpoint.changes=changes;checkpoint.observations=Object.fromEntries(observations);await ports.checkpoint?.(structuredClone(checkpoint));};
  const advance=async(index:number)=>{checkpoint.nextManage=index+1;delete checkpoint.pendingManageId;delete checkpoint.pendingStartedAt;await persist();};
  await persist();
  const stopped = async () => {
    if (!await ports.stopped()) return false;
    await ports.event({ status: 'stopped' });
    return true;
  };
  const observe = async (row: RotationRow) => {
    try { return await ports.observe(row, device); }
    catch (error) { if(error instanceof Error && error.name==='SearchAccessDenied')throw error; return { rank: null, observedAt: ports.now(), device }; }
  };
  if(checkpoint.phase==='observe'){
   for(let index=checkpoint.nextObserve;index<rows.length;index++){
    if(await stopped())return {changes,stopped:true};
    const row=rows[index];observations.set(row.id,await observe(row));
    if(await stopped())return {changes,stopped:true};
    checkpoint.nextObserve=index+1;await persist();
   }
   checkpoint.phase='manage';await persist();
  }
  for(let index=checkpoint.nextManage;checkpoint.phase==='manage'&&index<rows.length;index++){
    const row=rows[index];
    if (await stopped()) return { changes, stopped: true };
    let observation = observations.get(row.id)??{rank:null,device,observedAt:0};
    if (resumedObservations.has(row.id)||ports.now() - observation.observedAt > 60000){observation=await observe(row);observations.set(row.id,observation);}
    if(await stopped())return {changes,stopped:true};
    checkpoint.pendingManageId=row.id;checkpoint.pendingStartedAt=ports.now();await persist();
    const valid = observation.device === device && Number.isInteger(observation.rank) && observation.rank! > 0 && Number.isFinite(observation.observedAt) && observation.observedAt <= ports.now() && ports.now() - observation.observedAt <= 60000;
    if (ports.manage) {
      const managed=await ports.manage(row,valid?observation:{...observation,rank:null});
      if(managed.stopped)return {changes,stopped:true};
      if(managed.changed)changes++;
      await ports.event({id:row.id,status:managed.status,bid:managed.bid});
      await advance(index);continue;
    }
    if (!valid) { await ports.event({ id: row.id, status: 'unknown', bid: row.bid }); await advance(index);continue; }
    if (observation.rank! <= row.target) { await ports.event({ id: row.id, status: 'reached', bid: row.bid }); await advance(index);continue; }
    if (row.bid + 10 > row.max) { await ports.event({ id: row.id, status: 'capped', bid: row.bid }); await advance(index);continue; }
    if (await stopped()) return { changes, stopped: true };
    // Write errors abort the entire rotation, rather than proceeding with uncertain bids.
    const applied = await ports.apply(row.id, row.bid, row.bid + 10);
    if (applied === false) return { changes, stopped: true };
    if (applied && typeof applied === 'object' && applied.status === 'capped') {
      await ports.event({ id: row.id, status: 'capped', bid: applied.bid });
      await advance(index);continue;
    }
    changes++;
    await ports.event({ id: row.id, status: 'increased', bid: applied && typeof applied === 'object' ? applied.bid : row.bid + 10 });
    await advance(index);
  }
  checkpoint.phase='complete';await persist();
  if (changes && !ports.deferReflectionWait && !await stopped()) {
    await ports.event({ status: 'waiting' });
    // Chunk waits so a stop request can be noticed within five seconds.
    for (let remaining = waitSeconds; remaining > 0; remaining -= 5) {
      if (await stopped()) return { changes, stopped: true };
      await ports.wait(Math.min(5, remaining));
    }
  }
  return { changes, stopped: await stopped() };
}
