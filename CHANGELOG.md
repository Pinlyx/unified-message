# Changelog

## 0.1.0 - 2026-11-20

- Initial release.
- Parsers for Telegram, WhatsApp Cloud API, Instagram Messaging, Messenger and X (Account Activity API direct messages) into one `UnifiedMessage` / `UnifiedEvent` shape.
- Webhook verification: Meta `X-Hub-Signature-256`, Meta subscribe challenge, Telegram secret token header, X CRC response and `x-twitter-webhooks-signature`.
- Async Web Crypto variants and a `unified-message/web` entry point for edge runtimes.
