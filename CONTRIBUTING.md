# Contributing

Issues and pull requests are welcome.

- `npm install`, then `npm test` and `npm run build` must pass.
- Add a fixture under `test/fixtures/` for every payload shape you add, based on the official platform docs, with anonymized ids.
- Parsers must never throw: unknown input returns an `unsupported` event.
- Keep the package dependency free (runtime). Use `node:crypto` or Web Crypto only.
