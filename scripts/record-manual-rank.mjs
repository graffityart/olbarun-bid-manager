#!/usr/bin/env node
// Record an operator-observed rank. This is a claim, NOT independently verified geo evidence.
// Usage: node scripts/record-manual-rank.mjs /tmp/manual-device-ranks.json PC 2 "부산 직접 검색" "PC 검색 화면"
import { readFile, writeFile } from 'node:fs/promises';
import { normalizeAdHost } from '../lib/ad-sites.ts';

const [file, device, rawRank, location, evidence] = process.argv.slice(2);
if (!file || !['PC','MOBILE'].includes(device) || !/^[1-9][0-9]?$|^100$/.test(rawRank ?? '') ||
    !location?.trim() || !evidence?.trim() || process.argv.length !== 7) {
  console.error('Usage: node scripts/record-manual-rank.mjs manual.json PC|MOBILE 1..100 "location claim" "evidence description"');
  process.exit(2);
}
try {
  const manual = JSON.parse(await readFile(file, 'utf8'));
  if (!manual.keyword?.trim() || !normalizeAdHost(manual.expectedHost ?? '') ||
      !manual.observations || typeof manual.observations !== 'object' || Array.isArray(manual.observations)) {
    throw Error('Invalid manual record: keyword, expectedHost and observations are required');
  }
  const observedAt = new Date().toISOString();
  manual.observations[device] = {
    rank: Number(rawRank), observedAt, location: location.trim(), evidence: evidence.trim(),
    regionVerified: false, bidWriteAllowed: false
  };
  await writeFile(file, JSON.stringify(manual, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ file, device, rank: Number(rawRank), observedAt,
    regionVerified: false, bidWriteAllowed: false,
    note: 'Recorded at command execution time, not screenshot capture time. Location is operator-claimed and unverified.' }, null, 2));
} catch (error) {
  console.error('Manual rank recording failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
