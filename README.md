# Politik

Politik is a phone web app for a policymaker to ask what is going on.

Live site: https://politik.carnelian-tea.workers.dev

## Chat

Chat answers only when the user asks a real question. A greeting stays one short line.

A source card shows the URL, fetched time, source, and jurisdiction when the record has them.

## Sources

The Sources page lists jurisdictions, sources, a blocked source, and the latest documents. The latest documents are 10 California Attorney General releases. GeBIZ is listed at 3,485 documents. The blocked source is Singapore Statutes Online.

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
