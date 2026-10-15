# Politik

Politik is a phone web app for a policymaker to ask what is going on.

Live site: https://politik.rexheng-policy.workers.dev

## Chat

Chat answers only when the user asks a real question. A greeting stays one short line.

A source card shows the URL, fetched time, source, and jurisdiction when the record has them.

## Sources

The Sources page reads the policy dataset in D1. It shows the "as of" date, the record count per jurisdiction and per publisher, the 10 most recently published records, and the sources the build had to exclude, with the reason. With no data loaded it says so.

## Data

The policy dataset covers California and Singapore tech policy. `pnpm snapshot:build` builds it into `photon/data/snapshot/` (needs `GROQ_API_KEY`). `pnpm check:data` validates it. `pnpm seed:d1` loads it into the local D1 database, and `pnpm seed:d1 --remote` loads it into production. Seeding checks the snapshot first, applies the migrations, then wipes and reloads the tables. Use `--dir <path>` to seed another folder.

Policy data is only as current as the last seed, so any surface that shows it must show the snapshot's "as of" date (the Sources page does). To refresh, build and seed again. Until D1 is seeded, the chat and the Sources page show empty lists, not errors.

## Map

The map uses Mapbox and opens on California. Pins appear only when a record has coordinates.

## Talk

Talk uses Deepgram through the worker. The API key stays on the server.

## Jev

Jev (TypeSafe) labels who is affected, how significant the record is, and which desk should read it. Significance is high, medium, low, or abstain, from the evidence tiers in Mengesha et al., arXiv:2604.21412.

## Stack

Cloudflare Worker, with the static PWA in `photon/public`. The repo uses pnpm and wrangler.

## Local

```
pnpm install
pnpm exec wrangler dev
```

Put secrets in `.dev.vars`. Git ignores that file. Key names:

- TYPESAFE_API_KEY
- DEEPGRAM_API_KEY
- MAPBOX_ACCESS_TOKEN
- BROWSERBASE_API_KEY
- TELEGRAM_BOT_TOKEN
- OPENAI_API_KEY
- ELEVENLABS_API_KEY
- GROQ_API_KEY
