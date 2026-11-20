import { describe, expect, it } from 'vitest';
import {
  parse,
  parseInstagram,
  parseMessenger,
  parseTelegram,
  parseWhatsApp,
  parseX,
} from '../src/index.js';
import { fixture, fixtureText, only, onlyEvent, onlyMessage } from './helpers.js';

describe('parseTelegram', () => {
  it('parses a text message', () => {
    const m = onlyMessage(parseTelegram(fixture('telegram-text')));
    expect(m).toMatchObject({
      kind: 'message',
      channel: 'telegram',
      id: '41',
      conversationId: '100200300',
      from: { id: '100200300', name: 'Ada Lovelace', username: 'ada_l' },
      text: 'Hello bot',
      attachments: [],
      isEcho: false,
      timestamp: new Date(1763600000 * 1000).toISOString(),
    });
    expect(m.raw).toBeTruthy();
  });

  it('picks the largest photo and keeps the caption as text', () => {
    const m = onlyMessage(parseTelegram(fixture('telegram-photo')));
    expect(m.text).toBe('Look at this');
    expect(m.attachments).toEqual([{ type: 'image', mediaId: 'AgACAgIAAxkBAAIB_large', caption: 'Look at this' }]);
  });

  it('parses a location', () => {
    const m = onlyMessage(parseTelegram(fixture('telegram-location')));
    expect(m.text).toBeUndefined();
    expect(m.attachments).toEqual([{ type: 'location', lat: 41.0082, lon: 28.9784 }]);
  });

  it('parses a reply', () => {
    const m = onlyMessage(parseTelegram(fixture('telegram-reply')));
    expect(m.replyToId).toBe('44');
    expect(m.text).toBe('Yes, that one');
  });

  it('parses a document with mime and name', () => {
    const m = onlyMessage(parseTelegram(fixture('telegram-document')));
    expect(m.attachments[0]).toMatchObject({ type: 'file', mime: 'application/pdf', name: 'invoice.pdf', mediaId: 'BQACAgIAAxkBAAIC_doc' });
  });

  it('parses an edited message as an edit event', () => {
    const e = onlyEvent(parseTelegram(fixture('telegram-edited')), 'edit');
    expect(e.message.text).toBe('Hello bot (edited)');
    expect(e.timestamp).toBe(new Date(1763600300 * 1000).toISOString());
  });

  it('parses a callback query as a postback', () => {
    const e = onlyEvent(parseTelegram(fixture('telegram-callback')), 'postback');
    expect(e).toMatchObject({ payload: 'plan:pro', messageId: '44', conversationId: '100200300', from: { id: '100200300' } });
  });

  it('parses a reaction', () => {
    const e = onlyEvent(parseTelegram(fixture('telegram-reaction')), 'reaction');
    expect(e).toMatchObject({ messageId: '44', emoji: '\u{1F44D}', action: 'react', conversationId: '100200300' });
  });

  it('returns unsupported for service messages and unknown updates', () => {
    expect(only(parseTelegram(fixture('telegram-service'))).kind).toBe('unsupported');
    expect(only(parseTelegram(fixture('telegram-unsupported'))).kind).toBe('unsupported');
  });
});

describe('parseWhatsApp', () => {
  it('parses a text message with the profile name', () => {
    const m = onlyMessage(parseWhatsApp(fixture('whatsapp-text')));
    expect(m).toMatchObject({
      channel: 'whatsapp',
      id: 'wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=',
      conversationId: '16505551234',
      from: { id: '16505551234', name: 'Sheena Nelson' },
      to: { id: '106540352242922' },
      text: 'Does it come in another color?',
      isEcho: false,
      timestamp: new Date(1749416383 * 1000).toISOString(),
    });
  });

  it('parses an image as a media id, not a url', () => {
    const m = onlyMessage(parseWhatsApp(fixture('whatsapp-image')));
    expect(m.attachments).toEqual([{ type: 'image', mediaId: '1003383421387256', mime: 'image/jpeg', caption: 'This one' }]);
    expect(m.attachments[0]!.url).toBeUndefined();
  });

  it('parses a location with name and address', () => {
    const m = onlyMessage(parseWhatsApp(fixture('whatsapp-location')));
    expect(m.attachments).toEqual([{ type: 'location', lat: 38.4237, lon: 27.1428, name: 'Office', caption: 'Example Street 1' }]);
  });

  it('parses a reply via context.id', () => {
    const m = onlyMessage(parseWhatsApp(fixture('whatsapp-reply')));
    expect(m.replyToId).toBe('wamid.ORIG');
  });

  it('parses a reaction event', () => {
    const e = onlyEvent(parseWhatsApp(fixture('whatsapp-reaction')), 'reaction');
    expect(e).toMatchObject({ messageId: 'wamid.ORIG', emoji: '\u{1F600}', action: 'react', from: { id: '16505551234' } });
  });

  it('parses template buttons and list replies as postbacks', () => {
    const b = onlyEvent(parseWhatsApp(fixture('whatsapp-button')), 'postback');
    expect(b).toMatchObject({ payload: 'confirm-order', title: 'Confirm', messageId: 'wamid.TPL' });
    const l = onlyEvent(parseWhatsApp(fixture('whatsapp-interactive')), 'postback');
    expect(l).toMatchObject({ payload: 'row-2', title: 'Pro plan' });
  });

  it('parses documents and contacts', () => {
    const d = onlyMessage(parseWhatsApp(fixture('whatsapp-document')));
    expect(d.attachments[0]).toMatchObject({ type: 'file', name: 'quote.pdf', mediaId: '777000111', mime: 'application/pdf' });
    const c = onlyMessage(parseWhatsApp(fixture('whatsapp-contacts')));
    expect(c.attachments).toEqual([{ type: 'contact', name: 'Grace Hopper', caption: '+15550001111' }]);
  });

  it('parses every delivery status, including failures with an error', () => {
    const items = parseWhatsApp(fixture('whatsapp-status'));
    expect(items.map((i) => (i.kind === 'status' ? i.status : i.kind))).toEqual(['sent', 'delivered', 'read', 'failed']);
    const failed = items[3]!;
    expect(failed).toMatchObject({ kind: 'status', messageId: 'wamid.OUT2', recipientId: '16505551234', error: { code: '131047' } });
  });

  it('returns every message of a multi-entry body', () => {
    const items = parseWhatsApp(fixture('whatsapp-multi'));
    expect(items).toHaveLength(3);
    expect(items.map((i) => (i.kind === 'message' ? i.text : null))).toEqual(['one', 'two', 'three']);
    const third = items[2]!;
    expect(third.kind === 'message' && third.from.name).toBe('Second Customer');
    expect(third.kind === 'message' && third.to?.id).toBe('200000000000001');
  });

  it('returns unsupported for other webhook fields and message types', () => {
    expect(only(parseWhatsApp(fixture('whatsapp-other-field'))).kind).toBe('unsupported');
    expect(only(parseWhatsApp(fixture('whatsapp-unsupported-type'))).kind).toBe('unsupported');
  });
});

describe('parseInstagram', () => {
  it('parses text with ms timestamps', () => {
    const m = onlyMessage(parseInstagram(fixture('instagram-text')));
    expect(m).toMatchObject({
      channel: 'instagram',
      id: 'aWdfZAG1faWQ_text',
      conversationId: '1100000000000001',
      from: { id: '1100000000000001' },
      to: { id: '17841400000000001' },
      text: 'Is this still available?',
      isEcho: false,
      timestamp: new Date(1763600000123).toISOString(),
    });
  });

  it('parses an image attachment url', () => {
    const m = onlyMessage(parseInstagram(fixture('instagram-image')));
    expect(m.attachments).toEqual([{ type: 'image', url: 'https://cdn.example.test/ig/photo.jpg' }]);
  });

  it('parses replies to a message and to a story', () => {
    expect(onlyMessage(parseInstagram(fixture('instagram-reply'))).replyToId).toBe('aWdfZAG1faWQ_orig');
    expect(onlyMessage(parseInstagram(fixture('instagram-story-reply'))).replyToId).toBe('17900000000000001');
  });

  it('marks echoes and keys the conversation by the customer', () => {
    const m = onlyMessage(parseInstagram(fixture('instagram-echo')));
    expect(m.isEcho).toBe(true);
    expect(m.conversationId).toBe('1100000000000001');
    expect(m.from.id).toBe('17841400000000001');
  });

  it('parses reactions, seen and postbacks', () => {
    expect(onlyEvent(parseInstagram(fixture('instagram-reaction')), 'reaction')).toMatchObject({ emoji: '❤️', action: 'react', messageId: 'aWdfZAG1faWQ_echo' });
    expect(onlyEvent(parseInstagram(fixture('instagram-seen')), 'read')).toMatchObject({ messageId: 'aWdfZAG1faWQ_echo', conversationId: '1100000000000001' });
    expect(onlyEvent(parseInstagram(fixture('instagram-postback')), 'postback')).toMatchObject({ payload: 'ICEBREAKER_PRICING', title: 'Pricing' });
  });

  it('returns unsupported for non-message changes and for a Messenger body', () => {
    expect(only(parseInstagram(fixture('instagram-comment-change'))).kind).toBe('unsupported');
    expect(only(parseInstagram(fixture('messenger-text'))).kind).toBe('unsupported');
  });
});

describe('parseMessenger', () => {
  it('parses text', () => {
    const m = onlyMessage(parseMessenger(fixture('messenger-text')));
    expect(m).toMatchObject({ channel: 'messenger', id: 'm_text_1', conversationId: '5000000000000001', text: 'Hi, do you ship to Berlin?', to: { id: '109000000000001' } });
  });

  it('parses several attachments', () => {
    const m = onlyMessage(parseMessenger(fixture('messenger-attachment')));
    expect(m.attachments).toEqual([
      { type: 'image', url: 'https://cdn.example.test/fb/photo.png' },
      { type: 'audio', url: 'https://cdn.example.test/fb/voice.mp4' },
    ]);
  });

  it('detects stickers and locations', () => {
    expect(onlyMessage(parseMessenger(fixture('messenger-sticker'))).attachments[0]!.type).toBe('sticker');
    const loc = onlyMessage(parseMessenger(fixture('messenger-location'))).attachments[0]!;
    expect(loc).toMatchObject({ type: 'location', lat: 52.52, lon: 13.405 });
  });

  it('parses replies and echoes', () => {
    expect(onlyMessage(parseMessenger(fixture('messenger-reply'))).replyToId).toBe('m_orig_1');
    const echo = onlyMessage(parseMessenger(fixture('messenger-echo')));
    expect(echo).toMatchObject({ isEcho: true, conversationId: '5000000000000001', from: { id: '109000000000001' } });
  });

  it('parses postbacks, reads, deliveries and reactions', () => {
    expect(onlyEvent(parseMessenger(fixture('messenger-postback')), 'postback')).toMatchObject({ payload: 'GET_STARTED', title: 'Get started' });
    expect(onlyEvent(parseMessenger(fixture('messenger-read')), 'read').upTo).toBe(new Date(1763600055000).toISOString());
    const deliveries = parseMessenger(fixture('messenger-delivery'));
    expect(deliveries.map((d) => d.kind === 'status' && [d.messageId, d.status])).toEqual([
      ['m_echo_1', 'delivered'],
      ['m_echo_2', 'delivered'],
    ]);
    expect(onlyEvent(parseMessenger(fixture('messenger-reaction')), 'reaction').emoji).toBe('\u{1F44D}');
  });
});

describe('parseX', () => {
  it('parses a text DM with the users map and a sorted conversation id', () => {
    const m = onlyMessage(parseX(fixture('x-text')));
    expect(m).toMatchObject({
      channel: 'x',
      id: '1900000000000000001',
      conversationId: '4000000001-4000000002',
      from: { id: '4000000002', name: 'Jo Customer', username: 'jo_customer' },
      to: { id: '4000000001' },
      text: 'Hello from X',
      isEcho: false,
      timestamp: new Date(1763600000123).toISOString(),
    });
  });

  it('marks messages sent by the subscribed account as echoes', () => {
    const m = onlyMessage(parseX(fixture('x-echo')));
    expect(m.isEcho).toBe(true);
    expect(m.from.username).toBe('shop_support');
    expect(m.conversationId).toBe('4000000001-4000000002');
  });

  it('parses a photo and picks the best mp4 for video', () => {
    const img = onlyMessage(parseX(fixture('x-image')));
    expect(img.attachments).toEqual([
      { type: 'image', mediaId: '1900000000000009999', url: 'https://ton.twitter.com/1.1/ton/data/dm/1900000000000000003/1900000000000009999/abc.jpg' },
    ]);
    const vid = onlyMessage(parseX(fixture('x-video')));
    expect(vid.text).toBeUndefined();
    expect(vid.attachments).toEqual([{ type: 'video', mediaId: '1900000000000008888', mime: 'video/mp4', url: 'https://video.twimg.example.test/high.mp4' }]);
  });

  it('parses a shared location as lat/lon', () => {
    const m = onlyMessage(parseX(fixture('x-location')));
    expect(m.attachments).toEqual([{ type: 'location', lat: 37.7749, lon: -122.4194 }]);
  });

  it('parses mark-read events and returns unsupported for typing and tweets', () => {
    expect(onlyEvent(parseX(fixture('x-mark-read')), 'read')).toMatchObject({ conversationId: '4000000001-4000000002', from: { id: '4000000002' } });
    expect(only(parseX(fixture('x-typing'))).kind).toBe('unsupported');
    expect(only(parseX(fixture('x-tweet'))).kind).toBe('unsupported');
  });
});

describe('parse() and robustness', () => {
  it('dispatches by channel', () => {
    expect(onlyMessage(parse('telegram', fixture('telegram-text'))).channel).toBe('telegram');
    expect(onlyMessage(parse('whatsapp', fixture('whatsapp-text'))).channel).toBe('whatsapp');
    expect(onlyMessage(parse('instagram', fixture('instagram-text'))).channel).toBe('instagram');
    expect(onlyMessage(parse('messenger', fixture('messenger-text'))).channel).toBe('messenger');
    expect(onlyMessage(parse('x', fixture('x-text'))).channel).toBe('x');
  });

  it('accepts the raw JSON text of a body', () => {
    expect(onlyMessage(parse('whatsapp', fixtureText('whatsapp-text'))).text).toBe('Does it come in another color?');
    expect(onlyMessage(parse('x', new TextEncoder().encode(fixtureText('x-text')))).text).toBe('Hello from X');
  });

  it('returns unsupported for an unknown channel', () => {
    expect(only(parse('signal', {}))).toMatchObject({ kind: 'unsupported', channel: 'unknown' });
  });

  it.each(['telegram', 'whatsapp', 'instagram', 'messenger', 'x'])('never throws on garbage for %s', (channel) => {
    const garbage: unknown[] = [undefined, null, 0, 'not json', [], {}, { entry: 'x' }, { entry: [null, 1, { changes: [null] }] }, { message: 5 }, { object: 'page', entry: [{ messaging: [{ sender: 1 }, null] }] }, { direct_message_events: [null, { type: 3 }] }];
    for (const g of garbage) {
      const items = parse(channel, g);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) expect(item.kind).toBeTypeOf('string');
    }
  });

  it('keeps going when one message in a body is broken', () => {
    const body = fixture('whatsapp-multi') as { entry: Array<{ changes: Array<{ value: { messages: unknown[] } }> }> };
    body.entry[0]!.changes[0]!.value.messages.splice(1, 0, null, { type: 'text' });
    const kinds = parseWhatsApp(body).map((i) => i.kind);
    expect(kinds.filter((k) => k === 'message')).toHaveLength(3);
    expect(kinds).toContain('unsupported');
  });
});
