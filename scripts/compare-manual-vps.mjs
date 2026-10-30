#!/usr/bin/env node
// Read-only comparison of independently recorded manual PC/MOBILE ranks with VPS diagnostics.
// Never treats a manually supplied location as independently verified.
import { readFile } from 'node:fs/promises';
import { normalizeAdHost } from '../lib/ad-sites.ts';

const [manualPath, vpsPath] = process.argv.slice(2);
if (!manualPath || !vpsPath || process.argv.length !== 4) {
  console.error('Usage: node scripts/compare-manual-vps.mjs manual.json vps-device-compare.json');
  process.exit(2);
}
try {
  const [manual, vps] = await Promise.all([manualPath, vpsPath].map(async p => JSON.parse(await readFile(p, 'utf8'))));
  const host = normalizeAdHost(manual.expectedHost ?? '');
  if (!host || host !== vps.expectedHost || !manual.keyword || manual.keyword !== vps.keyword ||
      !vps.observations || typeof vps.observations !== 'object') {
    throw Error('Keyword/host mismatch or malformed VPS comparison; refusing comparison');
  }
  const devices = {};
  for (const device of ['PC', 'MOBILE']) {
    const m = manual.observations?.[device];
    const v = vps.observations?.[device];
    const rank = m?.rank;
    const validManualRank = Number.isSafeInteger(rank) && rank > 0 && rank <= 100;
    const manualRank = validManualRank ? rank : null;
    const vpsRank = Number.isSafeInteger(v?.rank) && v.rank > 0 ? v.rank : null;
    const vpsStatus = typeof v?.status === 'string' ? v.status : 'unknown';
    const manualTime = typeof m?.observedAt === 'string' ? Date.parse(m.observedAt) : NaN;
    const vpsTime = typeof v?.observedAt === 'string' ? Date.parse(v.observedAt) : NaN;
    const timeDifferenceMinutes = Number.isFinite(manualTime) && Number.isFinite(vpsTime)
      ? Math.round(Math.abs(manualTime - vpsTime) / 60000) : null;
    devices[device] = {
      manualRank, manualObservedAt: typeof m?.observedAt === 'string' ? m.observedAt : null,
      manualLocationClaim: typeof m?.location === 'string' ? m.location : null,
      manualEvidence: typeof m?.evidence === 'string' ? m.evidence : null,
      vpsRank, vpsStatus, vpsObservedAt: typeof v?.observedAt === 'string' ? v.observedAt : null,
      timeDifferenceMinutes, timeComparable: timeDifferenceMinutes !== null && timeDifferenceMinutes <= 5,
      comparison: manualRank === null ? 'NO_MANUAL_RANK' :
        vpsRank === null ? 'MANUAL_VISIBLE_VPS_NOT_OBSERVED' :
        manualRank === vpsRank ? 'RANKS_EQUAL_UNVERIFIED_ENVIRONMENTS' : 'RANK_DIFFERENCE',
      regionVerified: false, bidWriteAllowed: false
    };
  }
  console.log(JSON.stringify({
    keyword: manual.keyword, expectedHost: host, source: 'MANUAL_VS_VPS_DIAGNOSTIC',
    devices, regionVerified: false, bidWriteAllowed: false,
    caution: 'Manual location claims and VPS search results do not independently prove regional targeting. This report must not trigger bid writes.'
  }, null, 2));
} catch (error) {
  console.error('Comparison failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
