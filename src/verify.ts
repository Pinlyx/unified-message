import { createHmac, timingSafeEqual } from 'node:crypto';
import { sha256Digest, toBytes, type HeaderValue, type RawBody } from './verify-common.js';

export {
  verifyTelegramSecret,
  verifyMetaChallenge,
  type ChallengeQuery,
  type HeaderValue,
  type RawBody,
} from './verify-common.js';

function hmac(secret: string, body: RawBody): Buffer {
  return createHmac('sha256', secret).update(toBytes(body)).digest();
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verify Meta's `X-Hub-Signature-256` header (WhatsApp Cloud API, Instagram,
 * Messenger). `rawBody` must be the exact bytes Meta sent, not re-serialized JSON.
 */
export function verifyMetaSignature(rawBody: RawBody, header: HeaderValue, appSecret: string): boolean {
  const digest = sha256Digest(header);
  if (!digest || !appSecret || !/^[0-9a-fA-F]+$/.test(digest)) return false;
  const given = Buffer.from(digest.toLowerCase(), 'hex');
  return equalBytes(hmac(appSecret, rawBody), given);
}

/**
 * Answer X's CRC challenge (GET on your webhook URL with `?crc_token=...`).
 * Respond with the returned object as JSON, status 200.
 */
export function xCrcResponse(crcToken: string, consumerSecret: string): { response_token: string } {
  return { response_token: `sha256=${hmac(consumerSecret, crcToken).toString('base64')}` };
}

/**
 * Verify the `x-twitter-webhooks-signature` header on Account Activity API
 * POST requests. `rawBody` must be the exact bytes X sent.
 */
export function verifyXSignature(rawBody: RawBody, header: HeaderValue, consumerSecret: string): boolean {
  const digest = sha256Digest(header);
  if (!digest || !consumerSecret) return false;
  const expected = Buffer.from(`sha256=${hmac(consumerSecret, rawBody).toString('base64')}`, 'utf8');
  return equalBytes(expected, Buffer.from(`sha256=${digest}`, 'utf8'));
}
