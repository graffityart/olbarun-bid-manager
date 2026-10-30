#!/usr/bin/env node
// Read-only PC/MOBILE comparison from the same VPS. These are NOT verified Busan ranks.
import { spawnSync } from 'node:child_process';
import { normalizeAdHost } from '../lib/ad-sites.ts';
const [keyword, rawHost] = process.argv.slice(2);
const host = rawHost && normalizeAdHost(rawHost);
if (!keyword?.trim() || !host) {
  console.error('Usage: node scripts/compare-vps-devices.mjs "keyword" example.com');
  process.exit(1);
}
const observations = {};
for (const device of ['PC', 'MOBILE']) {
  const result = spawnSync(process.execPath, ['scripts/rank-check.mjs', keyword, host, device], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024
  });
  let raw;
  try { raw = JSON.parse(result.stdout); } catch { raw = null; }
  observations[device] = raw && raw.keyword === keyword && raw.expectedHost === host && raw.device === device
    ? { status: raw.status, rank: raw.rank ?? null, mainObservedCount: raw.mainObservedCount ?? null,
        moreObservedCount: raw.moreObservedCount ?? null, mainAds: raw.mainAds ?? [], moreAds: raw.moreAds ?? [],
        error: raw.error ?? null, regionVerified: false }
    : { status: 'unknown', rank: null, error: result.error?.message ?? result.stderr?.slice(-500) ?? 'Invalid collector output', regionVerified: false };
}
console.log(JSON.stringify({
  keyword, expectedHost: host, source: 'VPS_UNVERIFIED', regionVerified: false,
  bidWriteAllowed: false, observations,
  note: 'PC and MOBILE observations are from this VPS only. Neither establishes Busan targeting. Never use missing ads to increase bids.'
}, null, 2));
