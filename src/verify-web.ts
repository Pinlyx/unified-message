import { safeEqual, sha256Digest, toBytes, type HeaderValue, type RawBody } from './verify-common.js';

export {
  verifyTelegramSecret,
  verifyMetaChallenge,
  type ChallengeQuery,
  type HeaderValue,
  type RawBody,
} from './verify-common.js';

/** The slice of Web Crypto we use, declared locally so no DOM lib is needed. */
interface SubtleLike {
  importKey(
    format: 'raw',
    key: Uint8Array,
    algorithm: { name: 'HMAC'; hash: 'SHA-256' },
    extractable: boolean,
    usages: string[],
  ): Promise<unknown>;
  sign(algorithm: 'HMAC', key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
}

/**
 * HMAC SHA-256 through Web Crypto when the runtime has it (edge runtimes,
 * browsers, Node 19+), otherwise through node:crypto (Node 18).
 * The node:crypto import is lazy so edge bundles never reference it.
 */
async function hmacSha256(secret: string, body: RawBody): Promise<Uint8Array> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleLike } }).crypto?.subtle;
  const data = toBytes(body);
  if (subtle) {
    const key = await subtle.importKey('raw', toBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await subtle.sign('HMAC', key, data));
  }
  const { createHmac } = await import('node:crypto');
  return new Uint8Array(createHmac('sha256', secret).update(data).digest());
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Async twin of `verifyMetaSignature`, for runtimes where Web Crypto is the only option. */
export async function verifyMetaSignatureAsync(
  rawBody: RawBody,
  header: HeaderValue,
  appSecret: string,
): Promise<boolean> {
  const digest = sha256Digest(header);
  if (!digest || !appSecret) return false;
  return safeEqual(toHex(await hmacSha256(appSecret, rawBody)), digest.toLowerCase());
}

/** Async twin of `xCrcResponse`. */
export async function xCrcResponseAsync(
  crcToken: string,
  consumerSecret: string,
): Promise<{ response_token: string }> {
  return { response_token: `sha256=${toBase64(await hmacSha256(consumerSecret, crcToken))}` };
}

/** Async twin of `verifyXSignature`. */
export async function verifyXSignatureAsync(
  rawBody: RawBody,
  header: HeaderValue,
  consumerSecret: string,
): Promise<boolean> {
  const digest = sha256Digest(header);
  if (!digest || !consumerSecret) return false;
  return safeEqual(toBase64(await hmacSha256(consumerSecret, rawBody)), digest);
}
