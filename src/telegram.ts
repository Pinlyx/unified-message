import type { Attachment, Party, UnifiedItem, UnifiedMessage } from './types.js';
import { arr, coerceBody, guard, joinName, num, rec, str, toIso, unsupported, type Rec } from './util.js';

function party(user: Rec | undefined): Party | undefined {
  const id = str(user?.id);
  if (!user || id === undefined) return undefined;
  const name = joinName(user.first_name, user.last_name) ?? str(user.title);
  const username = str(user.username);
  return { id, ...(name ? { name } : {}), ...(username ? { username } : {}) };
}

function largestPhoto(sizes: unknown[]): Rec | undefined {
  let best: Rec | undefined;
  let bestArea = -1;
  for (const s of sizes) {
    const r = rec(s);
    if (!r) continue;
    const area = (num(r.width) ?? 0) * (num(r.height) ?? 0);
    if (area >= bestArea) {
      best = r;
      bestArea = area;
    }
  }
  return best;
}

function fileAttachment(type: Attachment['type'], f: Rec, caption?: string): Attachment {
  const a: Attachment = { type };
  const mediaId = str(f.file_id);
  if (mediaId) a.mediaId = mediaId;
  const mime = str(f.mime_type);
  if (mime) a.mime = mime;
  const name = str(f.file_name);
  if (name) a.name = name;
  if (caption) a.caption = caption;
  return a;
}

function attachmentsOf(m: Rec): Attachment[] {
  const out: Attachment[] = [];
  const caption = str(m.caption);
  const photo = largestPhoto(arr(m.photo));
  if (photo) out.push(fileAttachment('image', photo, caption));
  const video = rec(m.video);
  if (video) out.push(fileAttachment('video', video, caption));
  const animation = rec(m.animation);
  if (animation && !video) out.push(fileAttachment('video', animation, caption));
  const videoNote = rec(m.video_note);
  if (videoNote) out.push(fileAttachment('video', videoNote));
  const voice = rec(m.voice);
  if (voice) out.push(fileAttachment('audio', voice, caption));
  const audio = rec(m.audio);
  if (audio) out.push(fileAttachment('audio', audio, caption));
  const doc = rec(m.document);
  // Telegram also fills `document` for animations; the video attachment already covers those.
  if (doc && !animation) out.push(fileAttachment('file', doc, caption));
  const sticker = rec(m.sticker);
  if (sticker) out.push(fileAttachment('sticker', sticker));
  const venue = rec(m.venue);
  const loc = rec(venue?.location) ?? rec(m.location);
  if (loc) {
    const a: Attachment = { type: 'location', lat: num(loc.latitude), lon: num(loc.longitude) };
    const title = str(venue?.title);
    const address = str(venue?.address);
    if (title) a.name = title;
    if (address) a.caption = address;
    out.push(a);
  }
  const contact = rec(m.contact);
  if (contact) {
    const a: Attachment = { type: 'contact' };
    const name = joinName(contact.first_name, contact.last_name);
    if (name) a.name = name;
    const phone = str(contact.phone_number);
    if (phone) a.caption = phone;
    out.push(a);
  }
  const poll = rec(m.poll);
  if (poll) {
    const a: Attachment = { type: 'other' };
    const q = str(poll.question);
    if (q) a.caption = q;
    out.push(a);
  }
  return out;
}

function toMessage(m: Rec): UnifiedMessage | undefined {
  const chat = rec(m.chat);
  const chatId = str(chat?.id);
  const messageId = str(m.message_id);
  if (chatId === undefined || messageId === undefined) return undefined;
  const text = str(m.text) ?? str(m.caption);
  const attachments = attachmentsOf(m);
  if (text === undefined && attachments.length === 0) return undefined;
  const from = party(rec(m.from)) ?? party(rec(m.sender_chat)) ?? party(chat) ?? { id: chatId };
  const msg: UnifiedMessage = {
    kind: 'message',
    channel: 'telegram',
    id: messageId,
    conversationId: chatId,
    from,
    timestamp: toIso(m.date, 's'),
    attachments,
    isEcho: false,
    raw: m,
  };
  if (text !== undefined) msg.text = text;
  const replyTo = str(rec(m.reply_to_message)?.message_id);
  if (replyTo) msg.replyToId = replyTo;
  return msg;
}

/**
 * Parse one Telegram Bot API `Update` (the JSON body of a webhook request).
 * Returns an array for consistency with the other parsers; it holds one item.
 */
export function parseTelegram(update: unknown): UnifiedItem[] {
  const body = coerceBody(update);
  return guard('telegram', body, () => {
    const u = rec(body);
    if (!u) return [unsupported('telegram', 'body is not an object', body)];

    for (const key of ['message', 'channel_post', 'business_message'] as const) {
      const m = rec(u[key]);
      if (m) {
        const msg = toMessage(m);
        return [msg ?? unsupported('telegram', `${key} without text or media (service message)`, u)];
      }
    }

    for (const key of ['edited_message', 'edited_channel_post', 'edited_business_message'] as const) {
      const m = rec(u[key]);
      if (m) {
        const message = toMessage(m);
        if (!message) return [unsupported('telegram', `${key} without text or media`, u)];
        return [
          {
            kind: 'edit',
            channel: 'telegram',
            conversationId: message.conversationId,
            timestamp: toIso(m.edit_date ?? m.date, 's'),
            message,
            raw: u,
          },
        ];
      }
    }

    const cb = rec(u.callback_query);
    if (cb) {
      const from = party(rec(cb.from));
      if (!from) return [unsupported('telegram', 'callback_query without sender', u)];
      const m = rec(cb.message);
      const messageId = str(m?.message_id);
      const payload = str(cb.data);
      return [
        {
          kind: 'postback',
          channel: 'telegram',
          conversationId: str(rec(m?.chat)?.id) ?? from.id,
          timestamp: toIso(m?.date, 's'),
          from,
          ...(messageId ? { messageId } : {}),
          ...(payload ? { payload } : {}),
          raw: u,
        },
      ];
    }

    const reaction = rec(u.message_reaction);
    if (reaction) {
      const messageId = str(reaction.message_id);
      const chatId = str(rec(reaction.chat)?.id);
      if (!messageId || !chatId) return [unsupported('telegram', 'message_reaction without ids', u)];
      const added = arr(reaction.new_reaction).map(rec);
      const emoji = str(added.find((r) => r?.type === 'emoji')?.emoji);
      const from = party(rec(reaction.user)) ?? party(rec(reaction.actor_chat));
      return [
        {
          kind: 'reaction',
          channel: 'telegram',
          conversationId: chatId,
          timestamp: toIso(reaction.date, 's'),
          messageId,
          action: added.length > 0 ? 'react' : 'unreact',
          ...(emoji ? { emoji } : {}),
          ...(from ? { from } : {}),
          raw: u,
        },
      ];
    }

    return [unsupported('telegram', 'update type not supported', u)];
  });
}
