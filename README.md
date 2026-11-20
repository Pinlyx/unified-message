# unified-message

Turn incoming Telegram, WhatsApp, Instagram, Messenger and X webhooks into one message object, and verify each platform's webhook signature. TypeScript, zero runtime dependencies.

## Why it exists

Anyone building a multi-channel inbox or bot ends up rewriting the same two things: five different webhook payload shapes, and five different signature schemes. The open source options we found each miss a channel (a Rust crate without Instagram, a Ruby connector without Instagram) or depend on a hosted vendor API that sits between you and the platforms.

`unified-message` is only the pure part: payload in, normalized object out, plus the signature checks. No network calls, no accounts, no SDKs. You keep your own tokens and your own sending code.

## Install

The package is not on npm yet. Install it from GitHub (it builds itself on install):

```bash
npm install github:Pinlyx/unified-message
```

Requires Node 18 or newer. ESM only, with type declarations.

## Quick start

One Express app that verifies and parses all five channels:

```ts
import express from 'express';
import {
  parse, verifyMetaChallenge, verifyMetaSignature,
  verifyTelegramSecret, verifyXSignature, xCrcResponse,
} from 'unified-message';

const env = process.env as Record<string, string>;
const app = express();
app.use(express.raw({ type: '*/*' })); // req.body is a Buffer: the exact bytes the platform sent

function handle(channel: Parameters<typeof parse>[0], raw: Buffer) {
  for (const item of parse(channel, raw)) {
    if (item.kind === 'message') console.log(item.channel, item.conversationId, item.text, item.attachments);
    else console.log('event', item.kind, item);
  }
}

// Meta (WhatsApp, Instagram, Messenger): subscribe handshake + signed POST
for (const channel of ['whatsapp', 'instagram', 'messenger'] as const) {
  app.get(`/hooks/${channel}`, (req, res) => {
    const challenge = verifyMetaChallenge(req.query, env.META_VERIFY_TOKEN);
    challenge === null ? res.sendStatus(403) : res.send(challenge);
  });
  app.post(`/hooks/${channel}`, (req, res) => {
    if (!verifyMetaSignature(req.body, req.get('x-hub-signature-256'), env.META_APP_SECRET)) return res.sendStatus(401);
    handle(channel, req.body);
    res.sendStatus(200);
  });
}

// Telegram: the secret you passed to setWebhook
app.post('/hooks/telegram', (req, res) => {
  if (!verifyTelegramSecret(req.get('x-telegram-bot-api-secret-token'), env.TELEGRAM_SECRET)) return res.sendStatus(401);
  handle('telegram', req.body);
  res.sendStatus(200);
});

// X Account Activity API: CRC challenge + signed POST
app.get('/hooks/x', (req, res) => res.json(xCrcResponse(String(req.query.crc_token), env.X_CONSUMER_SECRET)));
app.post('/hooks/x', (req, res) => {
  if (!verifyXSignature(req.body, req.get('x-twitter-webhooks-signature'), env.X_CONSUMER_SECRET)) return res.sendStatus(401);
  handle('x', req.body);
  res.sendStatus(200);
});

app.listen(3000);
```

Answer the platform with 200 quickly and do the real work after. Meta and X retry slow or failing endpoints.

## Parsing

Every parser takes the parsed JSON body (or the raw JSON text, or bytes) and returns an array of items. Each item has a `kind`: `'message'` or one of the event kinds below. Parsers never throw: anything they do not understand comes back as `{ kind: 'unsupported', reason, raw }`.

```ts
import { parse, parseTelegram, parseWhatsApp, parseInstagram, parseMessenger, parseX } from 'unified-message';

parse('whatsapp', body);   // same as parseWhatsApp(body)
parseWhatsApp(body);       // one body can hold many messages and statuses
```

`parse(channel, body)` accepts `'telegram' | 'whatsapp' | 'instagram' | 'messenger' | 'x'`. All parsers return an array, even Telegram (always one item) so your handler is the same for every channel. The `isMessage(item)` helper narrows to `UnifiedMessage`.

### UnifiedMessage

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | `'message'` | Discriminator |
| `channel` | `'telegram' \| 'whatsapp' \| 'instagram' \| 'messenger' \| 'x'` | Where it came from |
| `id` | `string` | Platform message id (Telegram ids are unique per chat only) |
| `conversationId` | `string` | Thread key: Telegram chat id, the customer's id on WhatsApp, Instagram and Messenger, `<smaller>-<larger>` user ids on X |
| `from` | `{ id, name?, username? }` | Sender. Names are only present where the platform sends them (Telegram, WhatsApp profile name, X users map) |
| `to` | `{ id }?` | Recipient when the payload names it (WhatsApp phone number id, Meta page or account id, X user) |
| `timestamp` | `string` | ISO 8601, UTC |
| `text` | `string?` | Message text or media caption |
| `attachments` | `Attachment[]` | See below, empty array when none |
| `replyToId` | `string?` | Id of the message being replied to (story id for Instagram story replies) |
| `isEcho` | `boolean?` | `true` when your own account, page or bot sent it |
| `raw` | `unknown` | The untouched platform fragment |

### Attachment

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `'image' \| 'video' \| 'audio' \| 'file' \| 'sticker' \| 'location' \| 'contact' \| 'other'` | Normalized kind |
| `url` | `string?` | Direct URL, when the platform sends one |
| `mediaId` | `string?` | Platform media or file id you must resolve with a token |
| `mime` | `string?` | MIME type when known |
| `caption` | `string?` | Caption, or the address for locations, or the phone number for contacts |
| `lat`, `lon` | `number?` | Coordinates for `location` |
| `name` | `string?` | File name, place name or contact name |

### UnifiedEvent

| `kind` | When | Extra fields |
| --- | --- | --- |
| `read` | Messenger/Instagram read receipt, X mark-read | `from?`, `messageId?`, `upTo?` |
| `reaction` | Emoji reaction added or removed | `messageId`, `emoji?`, `action`, `from?` |
| `edit` | Telegram edited message | `message` (the new version) |
| `postback` | Button press: Telegram callback, WhatsApp button and list replies, Messenger/Instagram postbacks | `from`, `payload?`, `title?`, `messageId?` |
| `status` | Delivery status: WhatsApp sent/delivered/read/failed, Messenger deliveries | `messageId`, `status`, `recipientId?`, `error?` |
| `unsupported` | Anything else | `reason`, `raw` |

Every event except `unsupported` also has `channel`, `conversationId`, `timestamp` and `raw`.

## Verifying webhooks

Signature checks only work on the **raw request body bytes**. If you parse the JSON first and serialize it again, whitespace, key order and unicode escaping change and every valid request fails. Always capture the raw body before any JSON middleware touches it.

| Function | Platform | Header / input |
| --- | --- | --- |
| `verifyMetaSignature(rawBody, header, appSecret)` | WhatsApp, Instagram, Messenger | `X-Hub-Signature-256` (`sha256=<hex>`), signed with the app secret |
| `verifyMetaChallenge(query, verifyToken)` | Same, GET subscribe handshake | `hub.mode`, `hub.verify_token`, `hub.challenge`. Returns the challenge string to echo, or `null` (answer 403) |
| `verifyTelegramSecret(header, expected)` | Telegram | `X-Telegram-Bot-Api-Secret-Token`, the `secret_token` you set in `setWebhook` |
| `xCrcResponse(crcToken, consumerSecret)` | X, GET CRC check | Returns `{ response_token: 'sha256=<base64>' }` |
| `verifyXSignature(rawBody, header, consumerSecret)` | X, POST | `x-twitter-webhooks-signature` (`sha256=<base64>`) |

All comparisons are constant time. All of them return `false` (or `null`) on a missing or malformed header instead of throwing.

### Raw body in common frameworks

**Express**

```ts
app.post('/hooks/whatsapp', express.raw({ type: '*/*' }), (req, res) => {
  const ok = verifyMetaSignature(req.body /* Buffer */, req.get('x-hub-signature-256'), secret);
  // ...
});
```

If you must use `express.json()`, keep the bytes with `express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } })` and verify `req.rawBody`.

**Fastify**

```ts
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
app.post('/hooks/whatsapp', async (req, reply) => {
  const ok = verifyMetaSignature(req.body as Buffer, req.headers['x-hub-signature-256'], secret);
  // ...
});
```

**Next.js route handler** (use the async functions, they run on the edge runtime too)

```ts
import { parse, verifyMetaSignatureAsync } from 'unified-message/web';

export async function POST(req: Request) {
  const raw = await req.text(); // not req.json()
  if (!(await verifyMetaSignatureAsync(raw, req.headers.get('x-hub-signature-256'), process.env.META_APP_SECRET!))) {
    return new Response('bad signature', { status: 401 });
  }
  const items = parse('whatsapp', raw);
  return new Response('ok');
}
```

**Hono**

```ts
import { Hono } from 'hono';
import { parse, verifyMetaSignatureAsync } from 'unified-message/web';

const app = new Hono();
app.post('/hooks/whatsapp', async (c) => {
  const raw = await c.req.text();
  if (!(await verifyMetaSignatureAsync(raw, c.req.header('x-hub-signature-256'), c.env.META_APP_SECRET))) return c.text('bad signature', 401);
  const items = parse('whatsapp', raw);
  return c.text('ok');
});
```

### Edge runtimes

The main entry point imports `node:crypto` for the sync functions. `unified-message/web` contains the parsers plus async verifiers (`verifyMetaSignatureAsync`, `verifyXSignatureAsync`, `xCrcResponseAsync`) that use `globalThis.crypto.subtle` when it exists and fall back to `node:crypto` (loaded lazily) otherwise, so it is safe on Cloudflare Workers, Vercel Edge, Deno, Bun and Node 18+. The main entry also re-exports the async functions.

## Per-channel notes and limits

**Telegram.** Pass the `Update` object. Message, channel post, business message, edit, callback query and message reaction are handled. Photos pick the largest size. Files arrive as `mediaId` (a `file_id`): call `getFile` with your bot token to get a download path. Message ids are only unique inside a chat. Reactions need `message_reaction` in `allowed_updates` and an admin bot.

**WhatsApp Cloud API.** One body can contain several entries, changes, messages and statuses, which is why you always get an array. Media (image, video, audio, document, sticker) arrives as `mediaId` only: fetch the media URL from the Graph API with your access token, then download it with the same token. Text, media, location, contacts, reactions, template buttons and interactive replies are parsed. Orders, system messages and unknown types come back as `unsupported`. Status events cover sent, delivered, read, failed and deleted. Echoes of messages sent from the phone app (coexistence) are not parsed yet.

**Instagram Messaging.** Pass the body with `object: "instagram"`. Attachment URLs are temporary CDN links: download what you need soon. Story replies set `replyToId` to the story id. Shared posts, reels and story mentions become `other` or `video` attachments. Names and usernames are not in the webhook, only scoped ids; look them up with the Graph API if you need them. Comment and mention webhooks (the `changes` format) are `unsupported`.

**Messenger.** Pass the body with `object: "page"`. Echoes arrive through the `message_echoes` field and are marked `isEcho`. Delivery receipts become one `status` event per message id. Read receipts carry a watermark (`upTo`) instead of a message id. Attachment URLs are temporary.

**X (Account Activity API).** Handles `direct_message_events` with the `users` map, plus mark-read events. Messages sent by the subscribed account are marked `isEcho`. Photo and video URLs on `ton.twitter.com` need an authorized request to download. Typing indicators and everything that is not a direct message (tweets, follows, likes) are `unsupported`. Access to the Account Activity API depends on your X developer tier and the product is being phased out in favor of newer activity endpoints, so check what your tier can actually subscribe to before building on it. Location attachments follow the documented `shared_coordinate` shape on a best-effort basis.

**General.**
- This library does not send messages, download media, deduplicate retries or order events. Platforms retry webhooks, so dedupe on `id`.
- If a payload has no usable timestamp, `timestamp` is the time of parsing.
- `raw` is kept on every item so nothing is lost. It can hold personal data: do not log it blindly.
- Parsers are written from the official payload documentation. If a platform adds a field or type, it shows up in `raw` and, for unknown types, as `unsupported`. Issues with a sample payload (ids anonymized) are very welcome.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `npm install`, `npm test` and `npm run build` must pass, and every new payload shape needs an anonymized fixture in `test/fixtures/`.

## License

MIT, see [LICENSE](LICENSE).

Built and maintained by [Pinlyx](https://pinlyx.com/?utm_source=github&utm_medium=readme&utm_campaign=unified-message), an omnichannel inbox that runs this kind of normalization behind one inbox for every channel.
