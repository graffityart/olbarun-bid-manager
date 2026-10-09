// Explicit mappings for the user's two existing advertising groups.
export const AD_SITES: Readonly<Record<string, string>> = Object.freeze({
  '파워링크#1_광고그룹#1': 'lastwar.co.kr',
  '고장난폐노트북_전국택배': 'macpro.kr',
});

export function siteForGroup(group: string): string | null {
  return AD_SITES[group] ?? null;
}

export function normalizeAdHost(value: string): string | null {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch { return null; }
}

// Match only a verified destination/display host, never the ad tracking host.
export function matchesAdSite(destination: string, expectedHost: string): boolean {
  const expected = normalizeAdHost(expectedHost);
  return expected !== null && normalizeAdHost(destination) === expected;
}
