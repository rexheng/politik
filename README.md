# Politik

Politik is a phone web app for a policymaker to ask what is going on.

Live site: https://politik.rexheng-policy.workers.dev

## Chat

Chat answers only when the user asks a real question. A greeting stays one short line.

Answers come from the policy dataset and carry numbered markers. Tap a marker to jump to its source card. A card shows the title, jurisdiction, type and status, whether a person has reviewed the record, the date it was fetched when known, a quote and a link. A public post is labelled "Public post · Bluesky". Anything the model adds from its own knowledge sits in a separate box labelled "Not from Politik's sources — unverified". The footer reads "Data as of" and the snapshot date. With no `GROQ_API_KEY`, or if the model fails, chat lists the most relevant records instead of a summary.

## Sources

The Sources page reads the policy dataset in D1. It shows the "as of" date, the record count per jurisdiction and per publisher, the 10 most recently published records, and the sources the build had to exclude, with the reason. With no data loaded it says so.

## Data

The policy dataset covers California and Singapore tech policy. `pnpm snapshot:build` builds it into `photon/data/snapshot/` (needs `GROQ_API_KEY`). `pnpm check:data` validates it. `pnpm seed:d1` loads it into the local D1 database, and `pnpm seed:d1 --remote` loads it into production. Seeding checks the snapshot first, applies the migrations, then wipes and reloads the tables. It warns if the snapshot has fewer than 75% of the records already in that database. Use `--dir <path>` to seed another folder.

Chat uses two Groq models: a strong one that writes the answer and a fast one that routes the question. They default to `openai/gpt-oss-120b` (`GROQ_CHAT_MODEL`) and `openai/gpt-oss-20b` (`GROQ_ROUTER_MODEL`). Set either variable to use another Groq model; a blank value means the default.

Policy data is only as current as the last seed, so any surface that shows it must show the snapshot's "as of" date (the Sources page does). To refresh, build and seed again. Until D1 is seeded, the chat and the Sources page show empty lists, not errors.

Build caches live in `.tmp-snapshot/` (git ignores it):

- Downloads are in `raw/`. Each comes with `<id>.source.json`, `{ "url", "fetchedAt" }`, and a changed URL in `candidates.md` is fetched again. A `<id>.md` or `<id>.txt` you place there by hand (a Firecrawl capture, say) is used as it is; Markdown links and images are reduced to their text.
- Model answers are in `cache/`, keyed by the document's hash, the snapshot date and the models. An unchanged document costs no model calls.
- `pnpm snapshot:build --refresh` downloads everything it downloaded before again, and the GeBIZ list. Files you placed by hand, with no `.source.json`, are kept. `--refresh-all` replaces those too. Documents whose text did not change are not sent to the models again.
- The build refuses to write if more than 25% of the listed documents failed to load, or any landmark did, and it says how to run again. A stopped build remembers its date in `cache/in-progress.json`, so run `pnpm snapshot:build` again without `--date` and it reuses the answers it already has. `--allow-partial` writes the snapshot anyway.

In a container or sandbox that reaches the internet through a proxy, Node's `fetch` ignores `HTTP_PROXY` and `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set. Run `NODE_USE_ENV_PROXY=1 pnpm snapshot:build`. When every source fails as "unreachable", the build says to check this and the network settings.

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
- GROQ_CHAT_MODEL (optional)
- GROQ_ROUTER_MODEL (optional)
