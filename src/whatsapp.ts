import type { Attachment, DeliveryStatus, UnifiedItem, UnifiedMessage } from './types.js';
import { arr, coerceBody, guard, num, rec, str, toIso, unsupported, type Rec } from './util.js';

const MEDIA_TYPES: Record<string, Attachment['type']> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'file',
  sticker: 'sticker',
};

const STATUSES: readonly string[] = ['sent', 'delivered', 'read', 'failed', 'deleted'];

function mediaAttachment(type: Attachment['type'], m: Rec): Attachment {
  const a: Attachment = { type };
  const mediaId = str(m.id);
  if (mediaId) a.mediaId = mediaId;
  const mime = str(m.mime_type);
  if (mime) a.mime = mime;
  const caption = str(m.caption);
  if (caption) a.caption = caption;
  const filename = str(m.filename);
  if (filename) a.name = filename;
  return a;
}

function parseMessage(msg: Rec, names: Map<string, string>, toId: string | undefined): UnifiedItem[] {
  const from = str(msg.from);
  const id = str(msg.id);
  const type = str(msg.type) ?? '';
  if (!from || !id) return [unsupported('whatsapp', 'message without from or id', msg)];

  const ts = toIso(msg.timestamp, 's');
  const name = names.get(from);
  const sender = { id: from, ...(name ? { name } : {}) };
  const replyTo = str(rec(msg.context)?.id);

  if (type === 'reaction') {
    const r = rec(msg.reaction);
    const target = str(r?.message_id);
    if (!target) return [unsupported('whatsapp', 'reaction without message_id', msg)];
    const emoji = str(r?.emoji);
    return [
      {
        kind: 'reaction',
        channel: 'whatsapp',
        conversationId: from,
        timestamp: ts,
        from: sender,
        messageId: target,
        action: emoji ? 'react' : 'unreact',
        ...(emoji ? { emoji } : {}),
        raw: msg,
      },
    ];
  }

  // Template quick-reply buttons and interactive replies are button presses, not free text.
  let postback: { payload?: string; title?: string } | undefined;
  if (type === 'button') {
    const b = rec(msg.button);
    postback = { payload: str(b?.payload), title: str(b?.text) };
  } else if (type === 'interactive') {
    const i = rec(msg.interactive);
    const reply = rec(i?.button_reply) ?? rec(i?.list_reply);
    const flow = rec(i?.nfm_reply);
    if (reply) postback = { payload: str(reply.id), title: str(reply.title) };
    else if (flow) postback = { payload: str(flow.response_json), title: str(flow.name) };
  }
  if (postback) {
    return [
      {
        kind: 'postback',
        channel: 'whatsapp',
        conversationId: from,
        timestamp: ts,
        from: sender,
        ...(replyTo ? { messageId: replyTo } : {}),
        ...(postback.payload ? { payload: postback.payload } : {}),
        ...(postback.title ? { title: postback.title } : {}),
        raw: msg,
      },
    ];
  }

  const attachments: Attachment[] = [];
  let text: string | undefined;

  if (type === 'text') {
    text = str(rec(msg.text)?.body);
  } else if (type in MEDIA_TYPES) {
    const media = rec(msg[type]);
    if (media) attachments.push(mediaAttachment(MEDIA_TYPES[type]!, media));
  } else if (type === 'location') {
    const l = rec(msg.location);
    if (l) {
      const a: Attachment = { type: 'location', lat: num(l.latitude), lon: num(l.longitude) };
      const placeName = str(l.name);
      const address = str(l.address);
      if (placeName) a.name = placeName;
      if (address) a.caption = address;
      attachments.push(a);
    }
  } else if (type === 'contacts') {
    for (const c of arr(msg.contacts)) {
      const cr = rec(c);
      const a: Attachment = { type: 'contact' };
      const cname = str(rec(cr?.name)?.formatted_name);
      if (cname) a.name = cname;
      const phone = str(rec(arr(cr?.phones)[0])?.phone);
      if (phone) a.caption = phone;
      attachments.push(a);
    }
  } else {
    // order, system, unsupported, request_welcome and anything newer than this parser.
    return [unsupported('whatsapp', `message type "${type}" not supported`, msg)];
  }

  if (text === undefined && attachments.length === 0) {
    return [unsupported('whatsapp', `message type "${type}" had no readable content`, msg)];
  }

  const out: UnifiedMessage = {
    kind: 'message',
    channel: 'whatsapp',
    id,
    conversationId: from,
    from: sender,
    timestamp: ts,
    attachments,
    isEcho: false,
    raw: msg,
  };
  if (toId) out.to = { id: toId };
  if (text !== undefined) out.text = text;
  if (replyTo) out.replyToId = replyTo;
  return [out];
}

function parseStatus(s: Rec): UnifiedItem[] {
  const id = str(s.id);
  const status = str(s.status);
  const recipient = str(s.recipient_id);
  if (!id || !status || !STATUSES.includes(status)) {
    return [unsupported('whatsapp', `status "${status ?? ''}" not supported`, s)];
  }
  const err = rec(arr(s.errors)[0]);
  const error: { code?: string; message?: string } = {};
  if (err) {
    const code = str(err.code);
    const message = str(err.title) ?? str(err.message);
    if (code) error.code = code;
    if (message) error.message = message;
  }
  return [
    {
      kind: 'status',
      channel: 'whatsapp',
      conversationId: recipient ?? '',
      timestamp: toIso(s.timestamp, 's'),
      messageId: id,
      status: status as DeliveryStatus,
      ...(recipient ? { recipientId: recipient } : {}),
      ...(err ? { error } : {}),
      raw: s,
    },
  ];
}

/**
 * Parse a WhatsApp Cloud API webhook body. One body can carry many entries,
 * changes, messages and statuses, so this always returns an array.
 */
export function parseWhatsApp(body: unknown): UnifiedItem[] {
  const b = coerceBody(body);
  return guard('whatsapp', b, () => {
    const root = rec(b);
    if (!root || root.object !== 'whatsapp_business_account') {
      return [unsupported('whatsapp', 'not a whatsapp_business_account payload', b)];
    }
    const out: UnifiedItem[] = [];
    for (const e of arr(root.entry)) {
      for (const c of arr(rec(e)?.changes)) {
        const change = rec(c);
        const value = rec(change?.value);
        if (!change || !value) continue;
        if (change.field !== 'messages') {
          out.push(unsupported('whatsapp', `field "${str(change.field) ?? ''}" not supported`, change));
          continue;
        }
        const names = new Map<string, string>();
        for (const ct of arr(value.contacts)) {
          const cr = rec(ct);
          const waId = str(cr?.wa_id);
          const name = str(rec(cr?.profile)?.name);
          if (waId && name) names.set(waId, name);
        }
        const toId = str(rec(value.metadata)?.phone_number_id);
        for (const m of arr(value.messages)) {
          const mr = rec(m);
          if (mr) out.push(...parseMessage(mr, names, toId));
        }
        for (const s of arr(value.statuses)) {
          const sr = rec(s);
          if (sr) out.push(...parseStatus(sr));
        }
      }
    }
    return out;
  });
}
