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
const startedAt = new Date().toISOString();
for (const device of ['PC', 'MOBILE']) {
  const collectedAtStart = new Date().toISOString();
  const result = spawnSync(process.execPath, ['scripts/rank-check.mjs', keyword, host, device], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024
  });
  let raw;
  try { raw = JSON.parse(result.stdout); } catch { raw = null; }
  const collectedAtEnd = new Date().toISOString();
  observations[device] = result.status === 0 && raw && raw.keyword === keyword && raw.expectedHost === host && raw.device === device
    ? { status: raw.status, rank: raw.rank ?? null, observedAt: raw.observedAt ?? null,
        collectionStartedAt: collectedAtStart, collectionEndedAt: collectedAtEnd,
        mainObservedCount: raw.mainObservedCount ?? null,
        moreObservedCount: raw.moreObservedCount ?? null, mainAds: raw.mainAds ?? [], moreAds: raw.moreAds ?? [],
        moreStatus: raw.moreStatus ?? null, moreError: raw.moreError ?? null,
        error: raw.error ?? null, regionVerified: false }
    : { status: 'unknown', rank: null, collectionStartedAt: collectedAtStart,
        collectionEndedAt: collectedAtEnd,
        error: result.error?.message ?? (result.status !== 0 ? 'Collector exited with code '+result.status+': '+(raw?.error ?? result.stderr?.slice(-500) ?? '') : 'Invalid collector output'), regionVerified: false };
}
console.log(JSON.stringify({
  keyword, expectedHost: host, source: 'VPS_UNVERIFIED', startedAt,
  completedAt: new Date().toISOString(), regionVerified: false,
  bidWriteAllowed: false, observations,
  note: 'PC and MOBILE observations are from this VPS only. Neither establishes Busan targeting. Never use missing ads to increase bids.'
}, null, 2));
