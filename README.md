# Politik

Politik is a phone web app for a policymaker to ask what is going on.

Live site: https://politik.rexheng-policy.workers.dev

## Chat

Chat answers only when the user asks a real question. A greeting stays one short line.

Answers come from the policy dataset and carry numbered markers. Tap a marker to jump to its source card. A card shows the title, jurisdiction, type and status, whether a person has reviewed the record, the date it was fetched when known, a quote and a link. A public post is labelled "Public post · Bluesky". Anything the model adds from its own knowledge sits in a separate box labelled "Not from Politik's sources — unverified". The footer reads "Data as of" and the snapshot date. With no `GROQ_API_KEY`, or if the model fails, chat lists the most relevant records instead of a summary.

A long passage is shown to the model as the part around the words the search matched (up to 900 characters), and a source card quotes the stretch of the passage that the citing sentence rests on.

## Sources

The Sources page reads the policy dataset in D1. It shows the "as of" date, the record count per jurisdiction and per publisher, the 10 most recently published records, and the sources the build had to exclude, with the reason. With no data loaded it says so.

## Data

The policy dataset covers California and Singapore tech policy. `pnpm snapshot:build` builds it into `photon/data/snapshot/` (needs `GROQ_API_KEY`). `pnpm check:data` validates it. `pnpm seed:d1` loads it into the local D1 database, and `pnpm seed:d1 --remote` loads it into production. Seeding checks the snapshot first, applies the migrations, then wipes and reloads the tables. It warns if the snapshot has fewer than 75% of the records already in that database. Use `--dir <path>` to seed another folder.

Chat uses two Groq models: a strong one that writes the answer and a fast one that routes the question. They default to `openai/gpt-oss-120b` (`GROQ_CHAT_MODEL`) and `openai/gpt-oss-20b` (`GROQ_ROUTER_MODEL`). Set either variable to use another Groq model; a blank value means the default.

The free Groq tier allows 8,000 tokens a minute and 1,000 requests a day for these models, so each chat request is kept small: both models run at low reasoning effort, the writing model sees at most 8 sources, and each passage is cut to 900 characters. When a model call fails, the Worker logs one `chat: router failed (status=429 kind=http ...)` line (or `compose`, or `rank`) with the HTTP status and the kind of failure, never the key. `observability` is on in `wrangler.jsonc`, so `pnpm exec wrangler tail` and the dashboard show these lines. A 429 means the minute's tokens ran out: chat then answers with the fallback list.

Policy data is only as current as the last seed, so any surface that shows it must show the snapshot's "as of" date (the Sources page does). To refresh, build and seed again. Until D1 is seeded, the chat and the Sources page show empty lists, not errors.

Build caches live in `.tmp-snapshot/` (git ignores it):

- Downloads are in `raw/`. Each comes with `<id>.source.json`, `{ "url", "fetchedAt" }`, and a changed URL in `candidates.md` is fetched again. A `<id>.md` or `<id>.txt` you place there by hand (a Firecrawl capture, say) is used as it is; Markdown links and images are reduced to their text.
- Model answers are in `cache/`, keyed by the document's hash, the snapshot date and the models. An unchanged document costs no model calls.
- `pnpm snapshot:build --refresh` downloads everything it downloaded before again, and the GeBIZ list. Files you placed by hand, with no `.source.json`, are kept. `--refresh-all` replaces those too. Documents whose text did not change are not sent to the models again.
- The build refuses to write if more than 25% of the listed documents failed to load, or any landmark did, and it says how to run again. A stopped build remembers its date in `cache/in-progress.json`, so run `pnpm snapshot:build` again without `--date` and it reuses the answers it already has. `--allow-partial` writes the snapshot anyway.

In a container or sandbox that reaches the internet through a proxy, Node's `fetch` ignores `HTTP_PROXY` and `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set. Run `NODE_USE_ENV_PROXY=1 pnpm snapshot:build`. When every source fails as "unreachable", the build says to check this and the network settings.

## Limits

Two Workers Rate Limiting bindings count requests for each IP address (`ratelimits` in `wrangler.jsonc`; change `limit` and `period` there, `period` is 10 or 60 seconds):

- `ASK_LIMITER`, 10 a minute: `/api/ask`, `/api/voice/think`, `/api/voice/speak`, `/api/saying` (GET and POST, which search Bluesky and have every post judged by a model), `/telegram`, and the voice agent's questions.
- `VOICE_LIMITER`, 2 a minute: opening a voice socket, which is the `/api/voice/v1/agent/converse` upgrade (an agent session) and the `/api/voice/listen` upgrade (the plain Talk button). Each one is minutes of the Deepgram key. The two allowances are separate: an empty one does not stop the other. Note that the plain Talk button opens one listen socket for each spoken question, so it allows about two a minute for each address; raise `limit` if that is too tight.

The address is `CF-Connecting-IP`; an IPv6 address counts as its /64 prefix, because one person holds a whole /64 and can change address within it. A caller over the limit gets a normal answer with `mode: "fallback"`, no citations and the line "Politik is busy — please try again in a minute." (HTTP 200 on `/api/ask`, so the page shows it; the voice route speaks it and Telegram sends it). Every other route answers HTTP 429 with `{"error": "Politik is busy — please try again in a minute."}`, before a socket opens and before Deepgram is contacted; the page reads the 429 of a spoken reply as it is, and, because a browser cannot see why a socket was refused, asks the address of a socket again with a plain GET (which also takes a token from `VOICE_LIMITER`); either way it shows the line in the transcript. Requests to `localhost` (`wrangler dev`) and runs without a binding are never limited. Telegram sends every user's updates from its own few addresses, so when `TELEGRAM_WEBHOOK_SECRET` is set and the update carried it, its updates are counted for each chat (`telegram:<chat id>`) and every chat has its own allowance. **Set `TELEGRAM_WEBHOOK_SECRET` before the bot goes public.** Without it anyone can post updates with made-up chat ids, so updates are counted by the sender's address instead (all of Telegram's users would then share one allowance, and the bot would be open to anyone who finds the URL).

Telegram: set `TELEGRAM_WEBHOOK_SECRET` (a Wrangler secret) and register the webhook with the same value as `secret_token`:

```
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://politik.rexheng-policy.workers.dev/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

With the variable set, `/telegram` answers 401 to any request that does not carry the secret in `X-Telegram-Bot-Api-Secret-Token`. With it unset the check is off and the endpoint is open to anyone. An update that is not shaped like one (a JSON `null`, a `text` that is not a string) is answered 200 `ok` and ignored.

Origin: `POST /api/ask`, `POST /api/voice/think`, `POST /api/voice/speak`, `GET` and `POST /api/saying`, and the two voice socket addresses (`/api/voice/v1/agent/converse`, `/api/voice/listen`) answer 403 to a browser request whose `Origin` has a different host from the one it was sent to, before anything is counted or run, so another site's page cannot spend the keys from its visitors' browsers (a cross-site form post is refused too, whatever its content type). A request with no `Origin` is allowed: a browser sends none for its own page's simple requests, and a script that is not a browser can send any `Origin` it likes, so this is no defence against scripts; the rate limits are. `/telegram` has no `Origin` check (Telegram sends none; it has its secret).

`POST /api/voice/speak` takes a JSON object with a `text` of 1 to 2,000 characters; anything else is a 400, answered before a limiter token is spent.

Voice sessions: the worker closes both sockets of a voice session after 10 minutes, and after 60 seconds without a frame from the page. A text frame from the page of more than 256 KB is dropped. Deepgram bills agent time, so also set a spend cap on the Deepgram project.

## Evaluation

`pnpm eval:chat` asks a running Worker (`pnpm exec wrangler dev`, with the real snapshot seeded locally) the questions in `tests/eval/chat-golden.json` and writes `.tmp-eval/report.md`:

```
pnpm eval:chat [--base http://localhost:8787] [--no-judge] [--delay-ms 6000]
```

- It first asks "What is going on?" as a probe. If the Worker answers in fallback mode it stops with exit code 2 and "the Worker is answering in fallback mode — check GROQ_API_KEY", because every case would fail for that reason.
- Each case is checked for its mode, the records it cites, invalid markers, general-knowledge text and forbidden phrases. A golden record id that is not in `photon/data/snapshot/policies.json` is reported as "skipped (not in snapshot)" and does not fail the run.
- When every case has been answered, a Groq judge checks each cited sentence against its sources: the header line the writing model saw (title, place, status, date) and the passage heading and text. Faithfulness must reach 90%. The judge uses `GROQ_API_KEY` from the environment or, if it is not set, from `.dev.vars`, and `GROQ_JUDGE_MODEL` (default `openai/gpt-oss-20b`, not the model that writes the answers). `--no-judge` skips it.
- `--delay-ms` waits that long between requests and between judge calls. On the free tier use about 6000: a brief costs about 5,000 tokens of the 8,000 a minute.
- The report counts the responses in fallback mode. A high count means Groq refused or failed, not that the answers were poor.

## Map

The map uses Mapbox and opens on California. Pins appear only when a record has coordinates.

## Talk

Talk uses Deepgram through the worker. The API key stays on the server.

A spoken question runs the chat pipeline once. The Deepgram agent asks the worker for every real question through a `politik` function call on the socket the worker proxies (`/api/voice/v1/agent/converse`). The worker answers it once, speaks the reply (a fallback names up to three records: "The most relevant records are SB 53, ..."), and sends the page the full answer, citations included, in a `PolitikAnswer` frame down the same socket. The Deepgram widget cannot hand a response to the page and ignores a frame type it does not know, so `app.js` reads those frames off the socket (`tapVoiceAnswers` in `format.js`) and shows the answer like a typed one. The page never calls `/api/ask` for a spoken question. The worker keeps the voice session's earlier questions as the history for the next one. The agent only ever calls the worker, and the page cannot choose what the owner's Deepgram plan pays for. Every text frame from the page is parsed and written again, never passed on as it came (a frame that is not a JSON object, or is over 256 KB, is dropped). In every `think`, `speak` and `listen` section, wherever it sits in the message, each URL is taken out, and in the rest of a settings message too (the audio settings, the context, the keys at the top): any key named like `url`, `uri`, `href` or `endpoint`, any value that is a URL, and, in the sections, anything that is JSON written inside a string. The models are the server's whatever the page asks for (`VOICE_THINK_PROVIDER`, `VOICE_SPEAK_PROVIDER` and `VOICE_LISTEN_PROVIDER` in `photon/src/voice.ts`, set to what the page asks for today). A page that asks for a think endpoint is given the worker's own `/api/voice/think`, with no functions of its own, and a `speak` endpoint is dropped. Text that people write (injected messages, function responses) is not scrubbed. `/api/voice/think` is still there as an OpenAI-compatible endpoint (it runs the pipeline once per call), but the page no longer points the widget at it.

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
- TELEGRAM_WEBHOOK_SECRET (required before the bot goes public; see Limits)
- OPENAI_API_KEY
- ELEVENLABS_API_KEY
- GROQ_API_KEY
- GROQ_CHAT_MODEL (optional)
- GROQ_ROUTER_MODEL (optional)
- GROQ_JUDGE_MODEL (optional, for `pnpm eval:chat`)
