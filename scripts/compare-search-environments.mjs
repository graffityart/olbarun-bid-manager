// Read-only CLI: compare a manually verified screenshot record with a VPS rank-check JSON file.
// Manual rank is contextual evidence only; neither observation authorizes bid writes.
// node scripts/compare-search-environments.mjs manual.json vps.json
import { readFile } from 'node:fs/promises';
import { compareSearchEnvironments } from '../lib/search-environment-compare.ts';

if (process.argv.length !== 4) {
  console.error('Usage: node scripts/compare-search-environments.mjs manual.json vps.json');
  process.exit(2);
}
try {
  const [manual, vps] = await Promise.all(process.argv.slice(2).map(async path => JSON.parse(await readFile(path, 'utf8'))));
  const result = compareSearchEnvironments({manual, vps});
  const parseTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
  const manualTime = parseTime(manual.observedAt);
  const vpsTime = parseTime(vps.observedAt);
  const deltaMinutes = manualTime !== null && vpsTime !== null ? Math.round(Math.abs(manualTime-vpsTime)/60000) : null;
  const output = {
    ...result,
    manualObservedAt: manual.observedAt ?? null,
    vpsObservedAt: vps.observedAt ?? null,
    timeDifferenceMinutes: deltaMinutes,
    timeComparable: deltaMinutes !== null && deltaMinutes <= 5,
    environment: {
      manualLocation: manual.location ?? 'UNVERIFIED',
      vpsLocation: 'UNVERIFIED',
      locationComparable: false
    },
    caution: deltaMinutes === null ? 'Missing or invalid timestamps; temporal comparison not verified.' :
      deltaMinutes > 5 ? 'Observations over five minutes apart; rank differences may be time-dependent.' :
      'Times close, but geographic targeting and session conditions remain unverified.',
    bidWriteAllowed: false
  };
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.error('Comparison failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
