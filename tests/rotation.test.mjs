import test from 'node:test';
import assert from 'node:assert/strict';
import { runRotation } from '../lib/rotation.ts';
function fixture(overrides = {}) {
  let time = 1000000;
  const writes = [], events = [], reads = [];
  const ports = { now: () => time, stopped: async () => false,
    observe: async (row, device) => { reads.push(row.id); return { rank: 8, observedAt: time, device }; },
    apply: async (...args) => writes.push(args), event: async e => events.push(e),
    wait: async seconds => { time += seconds * 1000; }, ...overrides };
  return { ports, writes, events, reads, advance: seconds => { time += seconds * 1000; } };
}
const row = (id='a', extra={}) => ({ id, bid: 90, target: 4, max: 200, ...extra });
test('500 keywords are observed before writing and each increases exactly once', async () => {
  const f = fixture();
  f.ports.apply = async (...args) => { assert.equal(f.reads.length,500); f.writes.push(args); };
  const result = await runRotation(Array.from({length:500},(_,i)=>row(String(i))), 'PC', 180, f.ports);
  assert.equal(result.changes,500); assert.equal(new Set(f.writes.map(x=>x[0])).size,500);
  assert.ok(f.writes.every(x=>x[1]===90 && x[2]===100));
});
test('target, cap, missing rank and device mismatch never increase bids', async () => {
  const f = fixture({observe: async (r,d)=>({rank:r.id==='target'?2:r.id==='unknown'?null:8,observedAt:1000000,device:r.id==='device'?'MOBILE':d})});
  await runRotation([row('target'),row('cap',{max:90}),row('unknown'),row('device')], 'PC',120,f.ports);
  assert.equal(f.writes.length,0);
  assert.deepEqual(f.events.map(x=>x.status),['reached','capped','unknown','unknown']);
});
test('stale observations refresh after a large sequential query batch',async()=>{
  const f=fixture(); let count=0;
  f.ports.observe=async(r,d)=>{f.reads.push(r.id); f.advance(70); return {rank:++count>2?2:8,observedAt:f.ports.now(),device:d};};
  await runRotation([row('a'),row('b')],'PC',120,f.ports);
  assert.equal(f.writes.length,0);
  assert.deepEqual(f.reads,['a','b','a','b']);
});
test('stop during waiting exits without another increase',async()=>{
  const f=fixture();let stop=false;
  f.ports.stopped=async()=>stop;f.ports.wait=async()=>{stop=true;};
  const result=await runRotation([row()],'MOBILE',120,f.ports);
  assert.equal(result.stopped,true);assert.equal(result.changes,1);
});
test('ambiguous write failure aborts rotation and does not retry',async()=>{
  const f=fixture();let calls=0;f.ports.apply=async()=>{calls++;throw Error('timeout');};
  await assert.rejects(runRotation([row('a'),row('b')],'PC',120,f.ports),/timeout/);
  assert.equal(calls,1);
});
test('duplicate keywords rejected before observation',async()=>{
  const f=fixture();await assert.rejects(runRotation([row(),row()],'PC',120,f.ports));assert.equal(f.reads.length,0);
});
test('stop between final check and write does not count an increase',async()=>{
 const f=fixture({apply:async()=>false});const result=await runRotation([row('a'),row('b')],'PC',120,f.ports);assert.equal(result.stopped,true);assert.equal(result.changes,0);assert.equal(f.events.length,0);
});
