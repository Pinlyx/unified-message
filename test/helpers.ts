import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { UnifiedEvent, UnifiedItem, UnifiedMessage } from '../src/index.js';

export function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function fixtureText(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), 'utf8');
}

export function only(items: UnifiedItem[]): UnifiedItem {
  if (items.length !== 1) throw new Error(`expected 1 item, got ${items.length}`);
  return items[0]!;
}

export function onlyMessage(items: UnifiedItem[]): UnifiedMessage {
  const item = only(items);
  if (item.kind !== 'message') throw new Error(`expected message, got ${item.kind}`);
  return item;
}

export function onlyEvent<K extends UnifiedEvent['kind']>(items: UnifiedItem[], kind: K): Extract<UnifiedEvent, { kind: K }> {
  const item = only(items);
  if (item.kind !== kind) throw new Error(`expected ${kind}, got ${item.kind}`);
  return item as Extract<UnifiedEvent, { kind: K }>;
}
