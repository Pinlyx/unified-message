/** Verification helpers that need no crypto primitives, so they run on every runtime. */

export type HeaderValue = string | string[] | null | undefined;
export type RawBody = string | Uint8Array;

const encoder = new TextEncoder();

export function toBytes(body: RawBody): Uint8Array {
  return typeof body === 'string' ? encoder.encode(body) : body;
}

export function headerString(v: HeaderValue): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s !== '' ? s : undefined;
}

/** Constant-time string comparison (the loop always runs to the longer length). */
export function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Split `sha256=<digest>` and return the digest, or undefined when the header is not in that form. */
export function sha256Digest(header: HeaderValue): string | undefined {
  const h = headerString(header);
  if (!h || !h.startsWith('sha256=')) return undefined;
  const digest = h.slice('sha256='.length);
  return digest === '' ? undefined : digest;
}

/**
 * Check the `X-Telegram-Bot-Api-Secret-Token` header against the secret you
 * passed to `setWebhook`. An empty expected secret never matches.
 */
export function verifyTelegramSecret(headerValue: HeaderValue, expected: string): boolean {
  const got = headerString(headerValue);
  if (got === undefined || !expected) return false;
  return safeEqual(got, expected);
}

export type ChallengeQuery = string | URLSearchParams | Record<string, unknown>;

function queryGet(query: ChallengeQuery, key: string): string | undefined {
  if (typeof query === 'string') return new URLSearchParams(query.replace(/^\?/, '')).get(key) ?? undefined;
  if (query instanceof URLSearchParams) return query.get(key) ?? undefined;
  const direct = query[key];
  const v = Array.isArray(direct) ? direct[0] : direct;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  // Some parsers (qs with allowDots, Next.js helpers) nest "hub.mode" as { hub: { mode } }.
  const [head, tail] = key.split('.');
  const nested = head !== undefined ? query[head] : undefined;
  if (tail && typeof nested === 'object' && nested !== null) {
    const nv = (nested as Record<string, unknown>)[tail];
    const first = Array.isArray(nv) ? nv[0] : nv;
    if (typeof first === 'string') return first;
    if (typeof first === 'number') return String(first);
  }
  return undefined;
}

/**
 * Handle the GET subscribe handshake Meta sends when you save a webhook
 * (WhatsApp, Instagram, Messenger). Returns the `hub.challenge` string to echo
 * back with HTTP 200 when mode and token match, otherwise `null` (answer 403).
 */
export function verifyMetaChallenge(query: ChallengeQuery, verifyToken: string): string | null {
  const mode = queryGet(query, 'hub.mode');
  const token = queryGet(query, 'hub.verify_token');
  const challenge = queryGet(query, 'hub.challenge');
  if (mode !== 'subscribe' || token === undefined || challenge === undefined || !verifyToken) return null;
  return safeEqual(token, verifyToken) ? challenge : null;
}
