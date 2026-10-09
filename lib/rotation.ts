export type RotationRow = { id: string; bid: number; target: number; max: number };
export type RankResult = { rank: number | null; observedAt: number; device: 'PC' | 'MOBILE' };
export type RotationEvent = { id?: string; status: 'reached' | 'capped' | 'unknown' | 'increased' | 'stopped' | 'waiting'; bid?: number };
export type RotationPorts = {
  now(): number;
  stopped(): Promise<boolean>;
  observe(row: RotationRow, device: 'PC' | 'MOBILE'): Promise<RankResult>;
  // Must compare the expected bid with the effective Naver bid before writing.
  // A mismatch or ambiguous network result must throw; never retry a write blindly.
  apply(id: string, expectedBid: number, nextBid: number): Promise<void>;
  event(event: RotationEvent): Promise<void>;
  wait(seconds: number): Promise<void>;
};

// One rotation only: the durable host schedules the next rotation after this returns.
// All ranks are collected first. Old observations are refreshed before a write.
export async function runRotation(rows: RotationRow[], device: 'PC' | 'MOBILE', waitSeconds: number, ports: RotationPorts) {
  if (!rows.length || rows.length > 5000 || new Set(rows.map(r => r.id)).size !== rows.length || !['PC', 'MOBILE'].includes(device) || !Number.isInteger(waitSeconds) || waitSeconds < 120 || waitSeconds > 3600 || rows.some(r => !r.id || !Number.isInteger(r.bid) || r.bid < 70 || r.bid % 10 || !Number.isInteger(r.max) || r.max < 70 || r.max > 100000 || r.max % 10 || !Number.isInteger(r.target) || r.target < 1 || r.target > 10)) throw Error('Invalid rotation settings');
  const observations = new Map<string, RankResult>();
  let changes = 0;
  const stopped = async () => {
    if (!await ports.stopped()) return false;
    await ports.event({ status: 'stopped' });
    return true;
  };
  const observe = async (row: RotationRow) => {
    try { return await ports.observe(row, device); }
    catch { return { rank: null, observedAt: ports.now(), device }; }
  };
  for (const row of rows) {
    if (await stopped()) return { changes, stopped: true };
    observations.set(row.id, await observe(row));
  }
  for (const row of rows) {
    if (await stopped()) return { changes, stopped: true };
    let observation = observations.get(row.id)!;
    if (ports.now() - observation.observedAt > 60000) observation = await observe(row);
    const valid = observation.device === device && Number.isInteger(observation.rank) && observation.rank! > 0 && Number.isFinite(observation.observedAt) && observation.observedAt <= ports.now() && ports.now() - observation.observedAt <= 60000;
    if (!valid) { await ports.event({ id: row.id, status: 'unknown', bid: row.bid }); continue; }
    if (observation.rank! <= row.target) { await ports.event({ id: row.id, status: 'reached', bid: row.bid }); continue; }
    if (row.bid + 10 > row.max) { await ports.event({ id: row.id, status: 'capped', bid: row.bid }); continue; }
    if (await stopped()) return { changes, stopped: true };
    // Write errors abort the entire rotation, rather than proceeding with uncertain bids.
    await ports.apply(row.id, row.bid, row.bid + 10);
    changes++;
    await ports.event({ id: row.id, status: 'increased', bid: row.bid + 10 });
  }
  if (changes && !await stopped()) {
    await ports.event({ status: 'waiting' });
    // Chunk waits so a stop request can be noticed within five seconds.
    for (let remaining = waitSeconds; remaining > 0; remaining -= 5) {
      if (await stopped()) return { changes, stopped: true };
      await ports.wait(Math.min(5, remaining));
    }
  }
  return { changes, stopped: await stopped() };
}
