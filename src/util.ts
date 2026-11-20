import type { Channel, UnifiedItem, UnsupportedEvent } from './types.js';

export type Rec = Record<string, unknown>;

export function rec(v: unknown): Rec | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : undefined;
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Strings pass through, numbers and bigints become strings, everything else is undefined. */
export function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v === '' ? undefined : v;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  return undefined;
}

export function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Convert a platform timestamp to an ISO string. `unit` is what the platform
 * normally sends. In 'ms' mode a value below 1e11 is treated as seconds, so
 * hand-built test payloads still work. A missing or invalid value falls back
 * to the current time (the time we received it).
 */
export function toIso(v: unknown, unit: 's' | 'ms'): string {
  const n = num(v);
  if (n === undefined) return new Date().toISOString();
  const ms = unit === 's' || n < 1e11 ? n * 1000 : n;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function unsupported(channel: Channel | 'unknown', reason: string, raw: unknown): UnsupportedEvent {
  return { kind: 'unsupported', channel, reason, raw };
}

/** Run a parser body so that nothing it does can throw. */
export function guard(channel: Channel, raw: unknown, fn: () => UnifiedItem[]): UnifiedItem[] {
  try {
    const out = fn();
    return out.length > 0 ? out : [unsupported(channel, 'no events in payload', raw)];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return [unsupported(channel, `parser error: ${msg}`, raw)];
  }
}

/** Accept an already parsed object, or the raw JSON text of a webhook body. */
export function coerceBody(body: unknown): unknown {
  if (body instanceof Uint8Array) body = new TextDecoder().decode(body);
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  return body;
}

export function joinName(first?: unknown, last?: unknown): string | undefined {
  const parts = [str(first), str(last)].filter((x): x is string => x !== undefined);
  return parts.length > 0 ? parts.join(' ') : undefined;
}
