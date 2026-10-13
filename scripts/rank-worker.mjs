// Read-only Naver collector: this process has no advertising API write path.
import pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { siteForGroup } from '../lib/ad-sites.ts';

const sampleArg = process.argv.find(arg => arg.startsWith('--sample='));
const sample = sampleArg ? Number(sampleArg.split('=')[1]) : null;
if (sample !== null && (!Number.isInteger(sample) || sample < 1 || sample > 20)) {
  throw Error('--sample must be between 1 and 20');
}
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required in .env.worker');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1,
  connectionTimeoutMillis: 10000 });
const client=await pool.connect();
const lock=await client.query('SELECT pg_try_advisory_lock(704031027) AS locked');
if(!lock.rows[0].locked){client.release();await pool.end();throw Error('자동입찰 서비스와 동시에 수동 수집기를 실행할 수 없습니다. 서비스 중지 후 사용하세요.');}
const run = promisify(execFile);
const checker = fileURLToPath(new URL('./rank-check.mjs', import.meta.url));
let stop = false;
process.on('SIGTERM', () => { stop = true; });
process.on('SIGINT', () => { stop = true; });
const save = (id, data) => client.query(
  'INSERT INTO bid_states (id,data) VALUES ($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
  [id, JSON.stringify(data)]);
try {
  const { rows: states } = await client.query("SELECT data FROM bid_states WHERE id='main'");
  if (!states.length) throw Error('Save live keywords in the management screen first');
  const state = JSON.parse(states[0].data);
  if (state.mode !== 'live' || !Array.isArray(state.rows)) throw Error('Live keyword data required');
  if (!['PC', 'MOBILE'].includes(state.device)) throw Error('Select PC or MOBILE first');
  const rows = sample !== null ? state.rows.slice(0, sample) : state.rows.filter(row => row.selected);
  if (!rows.length || rows.length > 5000 || new Set(rows.map(row => row.id)).size !== rows.length) {
    throw Error('Select and save between 1 and 5000 distinct keywords');
  }
  const startedAt = new Date().toISOString();
  let completed = 0;
  await save('rank-worker', { state: 'collecting', device: state.device, total: rows.length,
    completed, startedAt, updatedAt: startedAt, mode: 'read-only' });
  for (const row of rows) {
    if (stop) break;
    const queryStartedAt = Date.now();
    const host = siteForRow(row);
    let result = { status: 'unknown', rank: null, error: 'Unconfigured advertising group' };
    if (host) {
      try {
        const { stdout } = await run(process.execPath, [checker, row.keyword, host, state.device],
          { timeout: 180000, maxBuffer: 1024 * 1024 });
        result = JSON.parse(stdout);
        if (result.device !== state.device || result.keyword !== row.keyword
          || result.expectedHost !== host) throw Error('Observation identity mismatch');
      } catch { result = { status: 'unknown', rank: null, error: 'Search observation failed' }; }
    }
    // Store separately from settings: a collection never overwrites bid or target.
    await save(`rank:${state.device}:${row.id}`, { id: row.id, keyword: row.keyword,
      device: state.device, host, status: result.status, rank: result.rank,
      source: result.source ?? null, adId: result.adId ?? null, mainRank: result.mainRank ?? null,
      moreRank: result.moreRank ?? null, moreObservedCount: result.moreObservedCount ?? 0, moreStatus: result.moreStatus ?? null,
      observedCount: result.observedCount ?? 0, observedAt: result.observedAt ?? new Date().toISOString(),
      error: result.error ?? null });
    completed++;
    await save('rank-worker', { state: 'collecting', device: state.device, total: rows.length,
      completed, startedAt, updatedAt: new Date().toISOString(), mode: 'read-only' });
    console.log(JSON.stringify({ keyword: row.keyword, device: state.device,
      status: result.status, rank: result.rank, completed, total: rows.length }));
    if (completed < rows.length && !stop) await new Promise(resolve => setTimeout(resolve, Math.max(0, 15000 - (Date.now() - queryStartedAt))));
  }
  await save('rank-worker', { state: stop ? 'stopped' : 'completed', device: state.device,
    total: rows.length, completed, startedAt, updatedAt: new Date().toISOString(), mode: 'read-only' });
} catch (error) {
  console.error('Collector failed:', error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]'));
  process.exitCode = 1;
} finally { await client.query('SELECT pg_advisory_unlock(704031027)').catch(()=>{});client.release();await pool.end(); }
