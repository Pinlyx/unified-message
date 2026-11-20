import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  verifyMetaChallenge,
  verifyMetaSignature,
  verifyMetaSignatureAsync,
  verifyTelegramSecret,
  verifyXSignature,
  verifyXSignatureAsync,
  xCrcResponse,
  xCrcResponseAsync,
} from '../src/index.js';
import * as web from '../src/web.js';
import { fixtureText } from './helpers.js';

const APP_SECRET = 'test_app_secret_0123456789';
const CONSUMER_SECRET = 'test_consumer_secret_abcdef';

const hex = (secret: string, body: string | Uint8Array) => createHmac('sha256', secret).update(body).digest('hex');
const b64 = (secret: string, body: string | Uint8Array) => createHmac('sha256', secret).update(body).digest('base64');

describe('verifyMetaSignature', () => {
  const body = fixtureText('whatsapp-text');
  const good = `sha256=${hex(APP_SECRET, body)}`;

  it('accepts a correct signature (string and bytes)', () => {
    expect(verifyMetaSignature(body, good, APP_SECRET)).toBe(true);
    expect(verifyMetaSignature(Buffer.from(body), good, APP_SECRET)).toBe(true);
    expect(verifyMetaSignature(new TextEncoder().encode(body), good.toUpperCase().replace('SHA256=', 'sha256='), APP_SECRET)).toBe(true);
  });

  it('matches a fixed known vector', () => {
    // HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog")
    const header = 'sha256=f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8';
    expect(verifyMetaSignature('The quick brown fox jumps over the lazy dog', header, 'key')).toBe(true);
  });

  it('rejects a tampered body, wrong secret, and malformed headers', () => {
    expect(verifyMetaSignature(body + ' ', good, APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, good, 'other')).toBe(false);
    expect(verifyMetaSignature(body, undefined, APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, null, APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, '', APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, hex(APP_SECRET, body), APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=', APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=zzzz', APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=abcd', APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, good, '')).toBe(false);
  });

  it('is sensitive to re-serialized JSON (raw bytes matter)', () => {
    const pretty = JSON.stringify(JSON.parse(body), null, 4);
    expect(verifyMetaSignature(pretty, good, APP_SECRET)).toBe(false);
  });

  it('accepts a header array like Node delivers for repeated headers', () => {
    expect(verifyMetaSignature(body, [good], APP_SECRET)).toBe(true);
  });

  it('async variant agrees with the sync one', async () => {
    expect(await verifyMetaSignatureAsync(body, good, APP_SECRET)).toBe(true);
    expect(await verifyMetaSignatureAsync(body, good, 'other')).toBe(false);
    expect(await verifyMetaSignatureAsync(body, 'nonsense', APP_SECRET)).toBe(false);
    expect(await web.verifyMetaSignatureAsync(Buffer.from(body), good, APP_SECRET)).toBe(true);
  });
});

describe('verifyMetaChallenge', () => {
  it('echoes the challenge for a matching token', () => {
    const q = { 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '1158201444' };
    expect(verifyMetaChallenge(q, 'tok')).toBe('1158201444');
  });

  it('works with a query string, URLSearchParams and nested objects', () => {
    expect(verifyMetaChallenge('?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=42', 'tok')).toBe('42');
    expect(verifyMetaChallenge(new URLSearchParams('hub.mode=subscribe&hub.verify_token=tok&hub.challenge=43'), 'tok')).toBe('43');
    expect(verifyMetaChallenge({ hub: { mode: 'subscribe', verify_token: 'tok', challenge: '44' } }, 'tok')).toBe('44');
  });

  it('returns null for a wrong token, wrong mode, or missing parts', () => {
    expect(verifyMetaChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'bad', 'hub.challenge': '1' }, 'tok')).toBeNull();
    expect(verifyMetaChallenge({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'tok', 'hub.challenge': '1' }, 'tok')).toBeNull();
    expect(verifyMetaChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok' }, 'tok')).toBeNull();
    expect(verifyMetaChallenge({}, 'tok')).toBeNull();
    expect(verifyMetaChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }, '')).toBeNull();
  });
});

describe('verifyTelegramSecret', () => {
  it('compares the header with the expected secret', () => {
    expect(verifyTelegramSecret('abc_DEF-123', 'abc_DEF-123')).toBe(true);
    expect(verifyTelegramSecret('abc_DEF-123', 'abc_DEF-124')).toBe(false);
    expect(verifyTelegramSecret('abc', 'abcd')).toBe(false);
    expect(verifyTelegramSecret(undefined, 'abc')).toBe(false);
    expect(verifyTelegramSecret(null, 'abc')).toBe(false);
    expect(verifyTelegramSecret('', '')).toBe(false);
    expect(verifyTelegramSecret(['abc'], 'abc')).toBe(true);
  });
});

describe('X verification', () => {
  const body = fixtureText('x-text');

  it('xCrcResponse returns sha256= plus base64 HMAC', () => {
    const r = xCrcResponse('crc_token_value', CONSUMER_SECRET);
    expect(r).toEqual({ response_token: `sha256=${b64(CONSUMER_SECRET, 'crc_token_value')}` });
    // Known vector: HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog") in base64.
    expect(xCrcResponse('The quick brown fox jumps over the lazy dog', 'key').response_token).toBe(
      'sha256=97yD9DBThCSxMpjmqm+xQ+9NWaFJRhdZl0edvC0aPNg=',
    );
  });

  it('verifyXSignature accepts the right header and rejects others', () => {
    const header = `sha256=${b64(CONSUMER_SECRET, body)}`;
    expect(verifyXSignature(body, header, CONSUMER_SECRET)).toBe(true);
    expect(verifyXSignature(Buffer.from(body), header, CONSUMER_SECRET)).toBe(true);
    expect(verifyXSignature(body + '\n', header, CONSUMER_SECRET)).toBe(false);
    expect(verifyXSignature(body, header, 'other')).toBe(false);
    expect(verifyXSignature(body, undefined, CONSUMER_SECRET)).toBe(false);
    expect(verifyXSignature(body, b64(CONSUMER_SECRET, body), CONSUMER_SECRET)).toBe(false);
    expect(verifyXSignature(body, 'sha256=', CONSUMER_SECRET)).toBe(false);
    expect(verifyXSignature(body, header.slice(0, -4), CONSUMER_SECRET)).toBe(false);
  });

  it('async variants agree', async () => {
    const header = `sha256=${b64(CONSUMER_SECRET, body)}`;
    expect(await verifyXSignatureAsync(body, header, CONSUMER_SECRET)).toBe(true);
    expect(await verifyXSignatureAsync(body, header, 'other')).toBe(false);
    expect(await xCrcResponseAsync('abc', CONSUMER_SECRET)).toEqual(xCrcResponse('abc', CONSUMER_SECRET));
    expect(await web.xCrcResponseAsync('abc', CONSUMER_SECRET)).toEqual(xCrcResponse('abc', CONSUMER_SECRET));
  });
});

describe('web crypto path', () => {
  it('works when globalThis.crypto.subtle is missing (node:crypto fallback)', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const body = 'payload';
      expect(await verifyMetaSignatureAsync(body, `sha256=${hex(APP_SECRET, body)}`, APP_SECRET)).toBe(true);
      expect(await xCrcResponseAsync('t', CONSUMER_SECRET)).toEqual({ response_token: `sha256=${b64(CONSUMER_SECRET, 't')}` });
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });

  it('uses globalThis.crypto.subtle when present', async () => {
    const subtle = (globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle;
    if (!subtle) return; // Node 18 without the global: the fallback test above covers it.
    const body = 'payload';
    expect(await verifyMetaSignatureAsync(body, `sha256=${hex(APP_SECRET, body)}`, APP_SECRET)).toBe(true);
  });
});
