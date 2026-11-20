import { parseInstagram, parseMessenger } from './meta.js';
import { parseTelegram } from './telegram.js';
import type { UnifiedItem } from './types.js';
import { unsupported } from './util.js';
import { parseWhatsApp } from './whatsapp.js';
import { parseX } from './x.js';

export { parseTelegram, parseWhatsApp, parseInstagram, parseMessenger, parseX };

/** Dispatch to the parser for `channel`. Unknown channels return an `unsupported` event. Never throws. */
export function parse(channel: string, body: unknown): UnifiedItem[] {
  switch (channel) {
    case 'telegram':
      return parseTelegram(body);
    case 'whatsapp':
      return parseWhatsApp(body);
    case 'instagram':
      return parseInstagram(body);
    case 'messenger':
      return parseMessenger(body);
    case 'x':
      return parseX(body);
    default:
      return [unsupported('unknown', `unknown channel "${String(channel)}"`, body)];
  }
}

export function isMessage(item: UnifiedItem): item is Extract<UnifiedItem, { kind: 'message' }> {
  return item.kind === 'message';
}
