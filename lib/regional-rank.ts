// Busan-only advertising: an observation is NOT regional proof merely because
// a browser uses Korean locale, timezone, geolocation override or a VPS IP.
// This module deliberately fails closed until an independently verified regional
// observation provider can supply an attested provenance record.
export const REQUIRED_REGION = 'KR-26'; // Busan metropolitan city

export function regionalRankVerified(observation, { device, keyword, host, now = Date.now() } = {}) {
  if (!observation || observation.region?.code !== REQUIRED_REGION) return false;
  if (observation.region?.verified !== true) return false;
  if (observation.region?.verificationMethod !== 'independent-provider') return false;
  if (typeof observation.region?.providerId !== 'string' || !observation.region.providerId.trim()) return false;
  if (typeof observation.region?.evidenceId !== 'string' || !observation.region.evidenceId.trim()) return false;
  if (!['PC', 'MOBILE'].includes(device) || observation.device !== device) return false;
  if (!keyword || observation.keyword !== keyword || !host || observation.expectedHost !== host) return false;
  if (observation.status !== 'visible' || !Number.isInteger(observation.rank) || observation.rank < 1) return false;
  const observedAt = Date.parse(observation.observedAt);
  if (!Number.isFinite(observedAt) || observedAt > now + 5000 || now - observedAt > 60000) return false;
  return true;
}

export function unverifiedRegionalObservation(observation) {
  return {
    ...observation,
    region: {
      code: REQUIRED_REGION,
      verified: false,
      verificationMethod: 'none',
      providerId: null,
      evidenceId: null,
      reason: 'VPS search results do not establish Busan geographic targeting',
    },
  };
}
