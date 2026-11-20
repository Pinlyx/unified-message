import type { Attachment, UnifiedItem, UnifiedMessage } from './types.js';
import { arr, coerceBody, guard, num, rec, str, toIso, unsupported, type Rec } from './util.js';

/** X names a 1:1 DM thread "<smaller user id>-<larger user id>". */
function conversationId(a: string, b: string): string {
  try {
    return BigInt(a) <= BigInt(b) ? `${a}-${b}` : `${b}-${a}`;
  } catch {
    return a <= b ? `${a}-${b}` : `${b}-${a}`;
  }
}

function mediaAttachment(media: Rec): Attachment {
  const kind = str(media.type);
  const a: Attachment = { type: kind === 'photo' ? 'image' : kind === 'video' || kind === 'animated_gif' ? 'video' : 'other' };
  const mediaId = str(media.id_str) ?? str(media.id);
  if (mediaId) a.mediaId = mediaId;
  let url = str(media.media_url_https) ?? str(media.media_url);
  if (a.type === 'video') {
    // Pick the highest bitrate mp4 variant; the poster image stays as the fallback.
    let bestBitrate = -1;
    for (const v of arr(rec(media.video_info)?.variants)) {
      const variant = rec(v);
      const vurl = str(variant?.url);
      if (!variant || !vurl || variant.content_type !== 'video/mp4') continue;
      const bitrate = num(variant.bitrate) ?? 0;
      if (bitrate > bestBitrate) {
        bestBitrate = bitrate;
        url = vurl;
        a.mime = 'video/mp4';
      }
    }
  }
  if (url) a.url = url;
  return a;
}

function messageAttachments(data: Rec): Attachment[] {
  const att = rec(data.attachment);
  if (!att) return [];
  const type = str(att.type);
  if (type === 'media') {
    const media = rec(att.media);
    return media ? [mediaAttachment(media)] : [];
  }
  if (type === 'location') {
    const coords = arr(rec(rec(rec(att.location)?.shared_coordinate)?.coordinates)?.coordinates);
    const a: Attachment = { type: 'location' };
    // GeoJSON order: [longitude, latitude].
    const lon = num(coords[0]);
    const lat = num(coords[1]);
    if (lat !== undefined) a.lat = lat;
    if (lon !== undefined) a.lon = lon;
    return [a];
  }
  return [{ type: 'other' }];
}

/**
 * Parse an X Account Activity API webhook body. Handles `direct_message_events`
 * (with the `users` map) and `direct_message_mark_read_events`. Other activity
 * (tweets, follows, typing indicators) comes back as `unsupported`.
 */
export function parseX(body: unknown): UnifiedItem[] {
  const b = coerceBody(body);
  return guard('x', b, () => {
    const root = rec(b);
    if (!root) return [unsupported('x', 'body is not an object', b)];
    const forUser = str(root.for_user_id);
    const users = rec(root.users) ?? {};
    const out: UnifiedItem[] = [];

    for (const e of arr(root.direct_message_events)) {
      const ev = rec(e);
      if (!ev) continue;
      const create = rec(ev.message_create);
      const id = str(ev.id);
      const senderId = str(create?.sender_id);
      const recipientId = str(rec(create?.target)?.recipient_id);
      if (ev.type !== 'message_create' || !create || !id || !senderId || !recipientId) {
        out.push(unsupported('x', `direct message event type "${str(ev.type) ?? ''}" not supported`, ev));
        continue;
      }
      const data = rec(create.message_data) ?? {};
      const text = str(data.text);
      const attachments = messageAttachments(data);
      const user = rec(users[senderId]);
      const name = str(user?.name);
      const username = str(user?.screen_name);
      const isEcho = forUser !== undefined && senderId === forUser;
      const msg: UnifiedMessage = {
        kind: 'message',
        channel: 'x',
        id,
        conversationId: conversationId(senderId, recipientId),
        from: { id: senderId, ...(name ? { name } : {}), ...(username ? { username } : {}) },
        to: { id: recipientId },
        timestamp: toIso(ev.created_timestamp, 'ms'),
        attachments,
        isEcho,
        raw: ev,
      };
      if (text !== undefined) msg.text = text;
      out.push(msg);
    }

    for (const e of arr(root.direct_message_mark_read_events)) {
      const ev = rec(e);
      const senderId = str(ev?.sender_id);
      const recipientId = str(rec(ev?.target)?.recipient_id);
      if (!ev || !senderId || !recipientId) continue;
      out.push({
        kind: 'read',
        channel: 'x',
        conversationId: conversationId(senderId, recipientId),
        timestamp: toIso(ev.created_timestamp, 'ms'),
        from: { id: senderId },
        raw: ev,
      });
    }

    if (out.length === 0) {
      const keys = Object.keys(root).filter((k) => k !== 'for_user_id' && k !== 'users');
      return [unsupported('x', `activity not supported: ${keys.join(', ') || 'empty payload'}`, b)];
    }
    return out;
  });
}
