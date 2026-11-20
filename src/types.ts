export type Channel = 'telegram' | 'whatsapp' | 'instagram' | 'messenger' | 'x';

export type AttachmentType =
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'other';

export interface Attachment {
  type: AttachmentType;
  /** Direct URL when the platform sends one (Messenger, Instagram, X). */
  url?: string;
  /** Platform media id or file id that must be fetched with a token (WhatsApp, Telegram). */
  mediaId?: string;
  mime?: string;
  caption?: string;
  lat?: number;
  lon?: number;
  /** File name, place name or contact name when the platform provides one. */
  name?: string;
}

export interface Party {
  id: string;
  name?: string;
  username?: string;
}

export interface UnifiedMessage {
  kind: 'message';
  channel: Channel;
  /** Platform message id. Telegram ids are unique per chat only. */
  id: string;
  /** The thread this message belongs to: chat id, customer id or X conversation id. */
  conversationId: string;
  from: Party;
  to?: { id: string };
  /** ISO 8601, UTC. */
  timestamp: string;
  text?: string;
  attachments: Attachment[];
  replyToId?: string;
  /** True when the message was sent by your own account/page/bot. */
  isEcho?: boolean;
  /** The original platform payload fragment, untouched. */
  raw: unknown;
}

interface EventBase {
  channel: Channel;
  conversationId: string;
  /** ISO 8601, UTC. */
  timestamp: string;
  raw: unknown;
}

export interface ReadEvent extends EventBase {
  kind: 'read';
  from?: { id: string };
  /** The message that was read, when the platform says which one. */
  messageId?: string;
  /** Everything up to this time was read (Messenger watermark). */
  upTo?: string;
}

export interface ReactionEvent extends EventBase {
  kind: 'reaction';
  from?: Party;
  messageId: string;
  emoji?: string;
  action: 'react' | 'unreact';
}

export interface EditEvent extends EventBase {
  kind: 'edit';
  /** The new version of the message. */
  message: UnifiedMessage;
}

export interface PostbackEvent extends EventBase {
  kind: 'postback';
  from: Party;
  /** The message the button was attached to, when known. */
  messageId?: string;
  payload?: string;
  title?: string;
}

export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed' | 'deleted';

export interface StatusEvent extends EventBase {
  kind: 'status';
  messageId: string;
  status: DeliveryStatus;
  recipientId?: string;
  error?: { code?: string; message?: string };
}

export interface UnsupportedEvent {
  kind: 'unsupported';
  channel: Channel | 'unknown';
  reason: string;
  raw: unknown;
}

export type UnifiedEvent =
  | ReadEvent
  | ReactionEvent
  | EditEvent
  | PostbackEvent
  | StatusEvent
  | UnsupportedEvent;

/** What every parser returns: messages and events, discriminated by `kind`. */
export type UnifiedItem = UnifiedMessage | UnifiedEvent;
