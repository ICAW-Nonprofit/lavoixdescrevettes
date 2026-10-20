// Campaign links (/c/<code>/, from a flyer, a poster or a post): the code stays in this tab (sessionStorage) for the
// visit, so what the visitor does next (J'y vais, share, newsletter) is counted for the campaign. Counts only, nothing
// about the person. Never throws and never waits: if counting fails, nothing changes for the visitor.
import { rpc } from './supabase-rpc.js';
import cfg from '../supabase.json';

export const CAMPAIGN_KEY = 'lvdc-campaign';

export function campaignCode() {
  try {
    return sessionStorage.getItem(CAMPAIGN_KEY);
  } catch {
    return null; // storage blocked
  }
}

/** kind: visit | rsvp | share_click | share_done | newsletter. slug: the action of a « J'y vais ». */
export function trackCampaign(kind, slug = null, code = campaignCode()) {
  if (!code || !cfg.url || !cfg.anonKey) return;
  try {
    rpc(cfg.url, cfg.anonKey, 'track_campaign', { p_code: code, p_kind: kind, p_slug: slug }).catch(() => {});
  } catch {
    /* never in the visitor's way */
  }
}
