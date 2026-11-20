import type { Attachment, Channel, UnifiedItem, UnifiedMessage } from './types.js';
import { arr, coerceBody, guard, num, rec, str, toIso, unsupported, type Rec } from './util.js';

type MetaChannel = Extract<Channel, 'instagram' | 'messenger'>;

const EXPECTED_OBJECT: Record<MetaChannel, string> = {
  instagram: 'instagram',
  messenger: 'page',
};

function attachment(a: Rec): Attachment {
  const type = str(a.type) ?? '';
  const payload = rec(a.payload);
  const out: Attachment = { type: 'other' };
  const url = str(payload?.url) ?? str(a.url);
  if (url) out.url = url;
  switch (type) {
    case 'image':
      // Messenger and Instagram send stickers as images that carry a sticker_id.
      out.type = payload?.sticker_id !== undefined ? 'sticker' : 'image';
      break;
    case 'video':
    case 'reel':
    case 'ig_reel':
      out.type = 'video';
      break;
    case 'audio':
      out.type = 'audio';
      break;
    case 'file':
      out.type = 'file';
      break;
    case 'location': {
      out.type = 'location';
      const c = rec(payload?.coordinates);
      const lat = num(c?.lat);
      const lon = num(c?.long);
      if (lat !== undefined) out.lat = lat;
      if (lon !== undefined) out.lon = lon;
      break;
    }
    default:
      out.type = 'other';
  }
  const title = str(a.title);
  if (title) out.caption = title;
  return out;
}

function parseMessaging(channel: MetaChannel, ev: Rec, entryTime: unknown): UnifiedItem[] {
  const senderId = str(rec(ev.sender)?.id);
  const recipientId = str(rec(ev.recipient)?.id);
  if (!senderId) return [unsupported(channel, 'messaging event without sender', ev)];
  const ts = toIso(ev.timestamp ?? entryTime, 'ms');

  const message = rec(ev.message);
  if (message) {
    const mid = str(message.mid);
    if (!mid) return [unsupported(channel, 'message without mid', ev)];
    if (message.is_deleted === true) return [unsupported(channel, 'message was unsent', ev)];
    const isEcho = message.is_echo === true;
    const attachments = arr(message.attachments)
      .map(rec)
      .filter((a): a is Rec => a !== undefined)
      .map(attachment);
    const text = str(message.text);
    if (text === undefined && attachments.length === 0) {
      return [unsupported(channel, 'message without text or attachments', ev)];
    }
    const replyTo = rec(message.reply_to);
    const replyToId = str(replyTo?.mid) ?? str(rec(replyTo?.story)?.id);
    const out: UnifiedMessage = {
      kind: 'message',
      channel,
      id: mid,
      // For an echo the page is the sender, so the thread is keyed by the other side.
      conversationId: isEcho ? (recipientId ?? senderId) : senderId,
      from: { id: senderId },
      timestamp: ts,
      attachments,
      isEcho,
      raw: ev,
    };
    if (recipientId) out.to = { id: recipientId };
    if (text !== undefined) out.text = text;
    if (replyToId) out.replyToId = replyToId;
    return [out];
  }

  const postback = rec(ev.postback);
  if (postback) {
    const messageId = str(postback.mid);
    const payload = str(postback.payload);
    const title = str(postback.title);
    return [
      {
        kind: 'postback',
        channel,
        conversationId: senderId,
        timestamp: ts,
        from: { id: senderId },
        ...(messageId ? { messageId } : {}),
        ...(payload ? { payload } : {}),
        ...(title ? { title } : {}),
        raw: ev,
      },
    ];
  }

  const read = rec(ev.read);
  if (read) {
    const messageId = str(read.mid);
    const watermark = num(read.watermark);
    return [
      {
        kind: 'read',
        channel,
        conversationId: senderId,
        timestamp: ts,
        from: { id: senderId },
        ...(messageId ? { messageId } : {}),
        ...(watermark !== undefined ? { upTo: toIso(watermark, 'ms') } : {}),
        raw: ev,
      },
    ];
  }

  const delivery = rec(ev.delivery);
  if (delivery) {
    const mids = arr(delivery.mids).map(str).filter((m): m is string => m !== undefined);
    if (mids.length === 0) return [unsupported(channel, 'delivery event without mids', ev)];
    const when = delivery.watermark !== undefined ? toIso(delivery.watermark, 'ms') : ts;
    return mids.map((messageId) => ({
      kind: 'status' as const,
      channel,
      conversationId: senderId,
      timestamp: when,
      messageId,
      status: 'delivered' as const,
      recipientId: senderId,
      raw: ev,
    }));
  }

  const reaction = rec(ev.reaction);
  if (reaction) {
    const messageId = str(reaction.mid);
    if (!messageId) return [unsupported(channel, 'reaction without mid', ev)];
    const emoji = str(reaction.emoji);
    return [
      {
        kind: 'reaction',
        channel,
        conversationId: senderId,
        timestamp: ts,
        from: { id: senderId },
        messageId,
        action: reaction.action === 'unreact' ? 'unreact' : 'react',
        ...(emoji ? { emoji } : {}),
        raw: ev,
      },
    ];
  }

  return [unsupported(channel, 'messaging event type not supported', ev)];
}

export function parseMeta(channel: MetaChannel, body: unknown): UnifiedItem[] {
  const b = coerceBody(body);
  return guard(channel, b, () => {
    const root = rec(b);
    if (!root || root.object !== EXPECTED_OBJECT[channel]) {
      return [unsupported(channel, `not an "${EXPECTED_OBJECT[channel]}" payload`, b)];
    }
    const out: UnifiedItem[] = [];
    for (const e of arr(root.entry)) {
      const entry = rec(e);
      if (!entry) continue;
      const messaging = arr(entry.messaging);
      for (const m of messaging) {
        const ev = rec(m);
        if (ev) out.push(...parseMessaging(channel, ev, entry.time));
      }
      // Anything delivered through `changes` (comments, mentions, ...) is not a direct message.
      for (const c of arr(entry.changes)) {
        out.push(unsupported(channel, `field "${str(rec(c)?.field) ?? ''}" not supported`, c));
      }
    }
    return out;
  });
}

/** Parse an Instagram Messaging webhook body (`object: "instagram"`). Returns an array. */
export function parseInstagram(body: unknown): UnifiedItem[] {
  return parseMeta('instagram', body);
}

/** Parse a Messenger webhook body (`object: "page"`). Returns an array. */
export function parseMessenger(body: unknown): UnifiedItem[] {
  return parseMeta('messenger', body);
}
