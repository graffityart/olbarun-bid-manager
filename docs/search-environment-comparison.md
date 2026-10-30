# General-search environment comparison (read-only)

For region-targeted ads, a VPS observation outside the target audience must never be treated as proof that an ad is outside its target rank. The comparison below is diagnostic only.

1. Save the JSON output of a read-only rank check, e.g. `node scripts/rank-check.mjs "화명동프랜차이즈철거" lastwar.co.kr MOBILE > /tmp/vps-rank.json`.
2. On the server, create `/tmp/manual-rank.json` with a manually checked rank and the actual screenshot timestamp. Example (replace the timestamp and location with verified values):

```json
{
  "keyword": "화명동프랜차이즈철거",
  "expectedHost": "lastwar.co.kr",
  "device": "MOBILE",
  "rank": 2,
  "observedAt": "2026-10-30T01:14:00.000Z",
  "location": "UNVERIFIED"
}
```

3. Run `node scripts/compare-search-environments.mjs /tmp/manual-rank.json /tmp/vps-rank.json`.

`timeComparable` only means timestamps are within five minutes. It does not verify either observation's location. The CLI never sends network requests or writes bids. Missing timestamps are explicitly flagged; do not fabricate timestamps. Do not put screenshots, cookies or credentials into the repository.

The bid worker's `REGION_UNVERIFIED` fail-closed guard remains in place.
