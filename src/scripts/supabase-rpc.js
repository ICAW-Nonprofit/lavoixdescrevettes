// Call a public Supabase function (rsvp, track…) with the publishable key: plain fetch, no library.
export function rpc(base, key, fn, body) {
  return fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    // new-style keys (sb_publishable_…) go in `apikey` only; legacy JWT anon keys also as a bearer token
    headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  });
}
