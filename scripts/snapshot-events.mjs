// Before each build: copy the actions from Supabase into src/content/events.json, and the campaign links
// (codes and destinations, no names) into src/content/campaigns.json.
// Those files are also the backup: if Supabase is unreachable, the site builds from the last copy.
import { readFileSync, writeFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync(new URL('../src/supabase.json', import.meta.url), 'utf8'));
const url = process.env.PUBLIC_SUPABASE_URL || cfg.url;
const key = process.env.PUBLIC_SUPABASE_ANON_KEY || cfg.anonKey;

const COLUMNS = [
  'id', 'slug', 'status', 'kind', 'title', 'title_en', 'target', 'starts_at', 'ends_at', 'street', 'postal_code', 'city',
  'lat', 'lng', 'meeting_point', 'access', 'access_en', 'summary', 'summary_en', 'description', 'description_en',
  'share_text', 'share_text_en', 'whatsapp_url', 'flyer_tagline', 'flyer_place', 'custom_poster', 'poster_alt',
  'recap_participants', 'recap_text', 'recap_links', 'created_at', 'updated_at',
];

if (!url || !key) {
  console.log('[snapshot] Supabase not configured: using src/content/events.json and campaigns.json as they are.');
  process.exit(0);
}

async function copy(path, file, what) {
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      // new-style keys (sb_publishable_…) go in `apikey` only; legacy JWT anon keys also as a bearer token
      headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('unexpected response');
    writeFileSync(new URL(`../src/content/${file}`, import.meta.url), JSON.stringify(rows, null, 2) + '\n');
    console.log(`[snapshot] ${rows.length} ${what} copied from Supabase.`);
  } catch (err) {
    // never break the build because of the database: keep the last copy
    console.warn(`[snapshot] Supabase unreachable (${err.message}). Using the last copy of src/content/${file}.`);
  }
}

await copy(`events?select=${COLUMNS.join(',')}&order=starts_at.asc`, 'events.json', 'action(s)');
// archived campaigns included: printed QR codes keep working
await copy('rpc/campaign_redirects', 'campaigns.json', 'campaign link(s)');
