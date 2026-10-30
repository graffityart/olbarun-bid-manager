// Pure read-only comparison. User screenshots are contextual evidence, NOT rank attestations.
import { normalizeAdHost } from './ad-sites.ts';
type SearchDevice = 'PC' | 'MOBILE';
type ManualObservation = {
  keyword: string;
  expectedHost: string;
  device: SearchDevice;
  rank: number;
};
type VpsObservation = {
  keyword: string;
  expectedHost: string;
  device: SearchDevice;
  status: string;
  rank: number | null;
};
export function compareSearchEnvironments({manual, vps}: {manual: ManualObservation; vps: VpsObservation}) {
  if (!manual || !vps) throw Error('Both observations required');
  const keyword=manual.keyword;
  const host=normalizeAdHost(manual.expectedHost);
  if (!keyword?.trim() || !host || manual.device !== vps.device ||
      !['PC','MOBILE'].includes(manual.device) || vps.keyword !== keyword ||
      normalizeAdHost(vps.expectedHost) !== host) throw Error('Observation identity mismatch');
  const manualRank=manual.rank;
  if (!Number.isInteger(manualRank) || manualRank < 1 || manualRank > 100) throw Error('Manual visible rank required');
  if (vps.status !== 'visible' && vps.status !== 'not_in_observed_list') throw Error('VPS observation inconclusive');
  if (vps.status === 'visible' && (vps.rank === null || !Number.isInteger(vps.rank) || vps.rank < 1)) throw Error('Invalid VPS rank');
  const different = vps.status !== 'visible' || vps.rank !== manualRank;
  return {
    keyword, expectedHost:host, device:manual.device,
    manualRank, vpsRank:vps.status==='visible'?vps.rank:null,
    status:different?'SEARCH_ENVIRONMENT_MISMATCH':'RANKS_AGREE_UNVERIFIED',
    regionVerified:false, bidWriteAllowed:false,
    note:'Manual screenshot and VPS observations do not independently verify geographic targeting or authorize bid writes.'
  };
}
