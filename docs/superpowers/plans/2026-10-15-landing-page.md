# ATMO-Style Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a landing page at `/` that copies atmo.ai's layout, type scale and motion. It uses Politik's palette and curated real photography, and every fact on it comes from the D1 snapshot. The chat app moves to `/ask`.

**Architecture:**
- Static `index.html` + `landing.css` + `landing.js` (an ES module with no dependencies).
- Data comes from a new Worker route, `GET /api/landing`, built only from store functions.
- Images are real, high-quality raster images (WebP, 1×/2×), produced by a repo script. Primary: curated real photographs (Unsplash License or Wikimedia Commons CC/PD). Secondary: elevation renders overlaid with real data points, and a NASA Blue Marble globe. No vector "art".
- Fidelity is checked by Playwright screenshots plus a computed-style comparison against the ATMO reference.

**Tech Stack:** Plain HTML/CSS/ES modules, Cloudflare Worker + D1, Playwright (pre-installed Chromium at `/opt/pw-browsers`), `node:test`, tsx.

**Spec:** `docs/superpowers/specs/2026-10-15-landing-page-design.md` (§n below). It runs after the chatbot plan, because both touch `index.html` and `app.js`.

**Reference material** (the session scratchpad; copy what you need into `.tmp-landing/reference/`):
- Folder: `/tmp/claude-0/-home-user-politik/d0dbb654-84b2-5271-b885-9efaeacb89b0/scratchpad/atmo/`
- Screenshots: `shots/home-full-1440.png`, `shots/home-full-390.png`, `shots/home-vp-0*-y*.png`
- Computed styles: `shots/home-computed-1440.json`, `shots/home-computed-390.json`
- CSS: `raw/site.css`, `site_rules_flat.txt`
- Interaction data: `ix2.json`

## Global Constraints

- Measurements, copied verbatim from spec §2:
  - Hairlines `0.75px solid`; 40px edge gutter; nav 51px.
  - Hero `height: 95vh; margin-top: 3.1rem`.
  - Hero grid: columns `1.5fr 2.5fr .75fr 1fr 1.5fr`, rows `.5fr .75fr 1fr .5fr`, no gap.
  - Section grids 1fr/2fr and 2fr/1fr; rows 1.5fr/1fr.
  - Radius 0, except the frosted panel at 5px.
  - No shadows.
- Type, weight 400 only:
  - **Inter Tight:** H1 50/1 −1.5px; H2 40/1 −0.8px; statement 30/1.1 −0.6px; section H2 24/1.1 −0.48px; sub 20/1.3 −0.44px; body 15/1.2.
  - **DM Mono:** labels 12/1.2 −0.12px uppercase where ATMO is uppercase.
  - Arrows 40px.
  - Breakpoints 991 / 767 / 479.
- Palette, set as tokens on `:root`: `--ink #0f0d0b`, `--paper #f6f1e7`, `--vanilla #e9dfc6`, `--accent #e8c468`, `--granite #9e9a92`, `--muted #7a766f`. The frosted panel is `rgba(177,177,177,.35)` with `backdrop-filter: blur(10px)`.
- Motion:
  - Nav hide/show: translateY 800ms ease.
  - Hero crossfade: opacity 1.2s, groups at 3s / 8s / 13s, 15s loop.
  - Sticky panels: opacity 1.5s.
  - Tab colour: 0.3s.
  - Arrow nudge: translateX(5px) 0.25s; CTA arrow translate(3px, −3px) 0.3s.
  - Everything is off under `prefers-reduced-motion`.
- No jQuery, GSAP, Lottie or frameworks. `landing.js` ≤ 12 KB.
- Images are WebP 1×/2× with `srcset`. Tiles are ≤ 300 KB and backgrounds ≤ 500 KB.
- No SVG noise fills, clip-art or gradient placeholders standing in for images.
- Every image source is credited in `photon/public/landing/CREDITS.md` and in the footer "Imagery:" line.
- Every number, status and date on the page comes from `/api/landing`. Hardcoded copy may describe the product, but never state a policy fact.
- Coordinates, verbatim from spec §4:
  - Sacramento 38.5766° N, 121.4934° W
  - Singapore Parliament 1.2894° N, 103.8505° E
  - California 36.7783° N, 119.4179° W
  - Singapore 1.3521° N, 103.8198° E
- Copy verbatim from spec §3: the H1, the hero continuation, the section headings, the mission sentences, the method statement and the footer tagline.
- Stage only the files the task names. Commit messages are one plain sentence plus the orchestrator's trailer.

## Review Focus

1. **Empty D1:** the page still renders fully. Readouts show coordinates and place names only, and the "What changed" list and the counts matrix are hidden. No `undefined` or `NaN` text appears. Pinned in Task 1 and Task 5.
2. **390px wide:** no horizontal scroll, and the hero becomes 3 columns. Pinned in Task 4 and Task 6 (a `scrollWidth === clientWidth` assertion).
3. **Reduced motion:** no running animations (`document.getAnimations().length === 0` after load). Pinned in Task 5.
4. **Very long record titles in the "What changed" rows:** they wrap without overlapping the ↗ column. Pinned in Task 5 with a long-title fixture.
5. **Keyboard only:** tab order reaches the nav, the hero CTA, every tab in "How it works", the ask field and the footer links, with visible focus. Pinned in Task 6.

---

### Task 1: `/api/landing` data endpoint

**Files:**
- Create: `photon/src/landing.ts`, `tests/landing/landing-data.test.ts`
- Modify: `photon/src/worker.ts` (route `GET /api/landing` with `cache-control: public, max-age=300`)

**Interfaces:**
- Produces:
  - `LandingData`, shaped exactly as in spec §4.
  - `loadLanding(db: D1Like): Promise<LandingData>`, built from `listRecords`, `recentChanges` and `getManifest` only.
    - `publishers` is the sorted unique `publisher` values.
    - `reviewed` is the count of records with `reviewState === "human-reviewed"`.
    - `landmarks` is the ≤ 4 landmark records with the newest `lastActivity`.
    - `latest` is `recentChanges({ since: "0000-01-01" }, 8)`.
    - When the manifest is null, it returns zero counts, empty lists and `asOf ""`.

- [ ] **Step 1: Write failing tests** (fixture D1):
  - `counts.records === 6`.
  - `byJurisdiction` is `{ "US-CA": 3, SG: 3 }`.
  - `reviewed === 1`.
  - `landmarks.length ≤ 4`, all of them landmarks.
  - `latest` is sorted by date descending and has ≤ 8 items.
  - Unseeded → zeros and `asOf ""`.
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement**, including the worker route.
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit.** "Add the landing page data endpoint."

---

### Task 2: Move the app to `/ask`; `?q=` deep link

**Files:**
- Create: `photon/public/ask.html` (the current `index.html` content, moved), `photon/public/query.js`, `tests/landing/query.test.ts`
- Modify:
  - `photon/public/index.html`: a placeholder landing shell for now (`<h1>Politik</h1>` and a link to `/ask`); Task 4 replaces it.
  - `photon/public/app.js`: on load, call `readInitialQuestion(location.href)`. If it returns a question, submit it once and `history.replaceState` to `/ask`.
  - The nav in `map.html`, `sources.html`, `saying.html` and `jev.html`: "Ask" → `/ask`.
  - `manifest.webmanifest`: `start_url: "/ask"`.
  - `sw.js`: shell assets include `/ask` and the cache version is bumped.

**Interfaces:**
- Produces: `readInitialQuestion(href: string): string | null` in `query.js` (ES module). It reads `q`, trims it, returns `null` for empty input, and caps the result at 1,000 chars.

- [ ] **Step 1: Write failing tests.**
  - `"https://x/ask?q=Explain%20SB%2053"` → `"Explain SB 53"`.
  - `"https://x/ask"` → `null`.
  - `"?q=%20%20"` → `null`.
  - A 2,000-char `q` → length 1,000.
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Then grep `photon/public` for `href="/"` used as "Ask" and update each one.
- [ ] **Step 4: Run checks.**
  - `pnpm test` → PASS.
  - A Playwright smoke run against `wrangler dev`: `/ask?q=hi` shows the user bubble "hi" and the URL becomes `/ask`; `/` returns 200.
- [ ] **Step 5: Commit.** "Move the chat to /ask and accept a question in the link."

---

### Task 3: Image curation, pipeline and assets (real photography first; revised 2026-10-15)

**Files:**
- Create `photon/scripts/landing/images/` with these modules:
  - `photos.ts` downloads curated photos from the manifest, crops to the slot aspect, and applies the light grade.
  - `relief.ts` builds the hillshade plus thermal ramp and overlays the real data points.
  - `globe.ts` builds the orthographic Blue Marble globe.
  - `doctiles.ts` renders snapshot passages to images via a Playwright screenshot.
  - `build.ts` runs everything and writes WebP at 1× and 2× with `sharp`.
- Create `photon/scripts/landing/images/photos.json`, the curated manifest. Each entry is `{ slot, url, sourcePage, author, licence, licenceUrl, focal: [x,y] }`.
- Create the outputs `photon/public/landing/img/*.webp` and `photon/public/landing/CREDITS.md`.
- Create the test `tests/landing/images.test.ts`.
- Modify `package.json`: add the script `"landing:images": "tsx photon/scripts/landing/images/build.ts"`. Add `sharp` as a devDependency if it isn't already resolvable.

**Interfaces:**
- Pure helpers (unit-tested):
  - `thermalRamp(t): [r,g,b]`
  - `orthographic(lat, lng, centre): {x, y, visible}`
  - `bboxToTiles(bbox, zoom)`
  - `coverCrop(srcW, srcH, dstW, dstH, focal): {left, top, width, height}`
  - `credits(entries): string`
  - `validateManifest(entries): string[]`. It accepts only licences in {Unsplash License, CC0, Public domain, CC BY 4.0, CC BY-SA 4.0, CC BY 3.0, CC BY-SA 3.0} and requires every field.
- `IMAGE_SET` lists the required outputs. Sizes are at 2×.

  | Output | Size (2×) | Source |
  |---|---|---|
  | `photo-1` … `photo-6` (hero, mission, method slots) | 1200×900 | curated photos |
  | `heat-ca`, `heat-sg` | 1200×900 | relief + data, crossfade partners |
  | `globe` | 1280×1280 | Blue Marble |
  | `doc-1` … `doc-3` | 1200×900 | |
  | `bg-ask`, `bg-mission` | 2880×1800 | full-bleed photos, or a relief field if no photo passes |

- Rules:
  - Never upscale: a photo's original resolution must be at least the 2× output.
  - Choose photos for ATMO's tone: cinematic, natural light, high contrast, one strong subject. Reject anything that is cliché stock (handshakes, gavels, a "hacker in a hoodie"), shows a watermark, contains logos or trademarks as the subject, or shows identifiable people as the main subject.
  - Every image's licence and attribution goes into `CREDITS.md`.
  - Wikimedia API requests send `User-Agent: PolitikLandingImages/1.0 (https://github.com/rexheng/politik)` and stay within its rate limits.

- [ ] **Step 1: Write failing tests** for the pure helpers, `validateManifest`, and an output-manifest check (every `IMAGE_SET` entry has 1× and 2× files at the stated size and within budget).
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Curate.**
  - For each photo slot, find 3–5 candidates: web search `site:unsplash.com/photos <subject>`, then download from images.unsplash.com, or use the Wikimedia API.
  - Build a candidate contact sheet at `.tmp-landing/candidates.png` and Read it.
  - Choose the best per slot and record it in `photos.json` with the reason.
- [ ] **Step 4: Build.** Run `NODE_USE_ENV_PROXY=1 pnpm landing:images`.
  - Build `.tmp-landing/contact-sheet.png` showing our final images beside ATMO's `home-vp-00-y0.png` hero, and Read it.
  - Redo anything that looks flat, blurry, off-tone or cliché.
- [ ] **Step 5:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 6: Commit.** "Curate real photography and generate the landing imagery."
- [ ] **Quality gate (controller):** after the task review, a separate vision reviewer on the most capable model rates each image "would pass on atmo.ai" or "redo" from the contact sheet. Every "redo" goes back to the implementer before Task 4 starts.

---|---|---|
  | `sat-sacramento` | 1200×900 | Sentinel-2 |
  | `sat-santaclara` | 1200×900 | Sentinel-2 |
  | `sat-sg-civic` | 1200×900 | Sentinel-2 |
  | `sat-sg-tuas` | 1200×900 | Sentinel-2 |
  | `heat-ca` | 1200×900 | relief + data |
  | `heat-sg` | 1200×900 | relief + data |
  | `heat-santaclara` | 1200×900 | relief + data |
  | `heat-tuas` | 1200×900 | relief + data |
  | `globe` | 1280×1280 | Blue Marble |
  | `doc-1` … `doc-4` | 1200×900 | snapshot passages |
  | `bg-ask` | 2880×1800 | relief/thermal field |
  | `bg-mission` | 2880×1800 | relief/thermal field |
  | `photo-1`, `photo-2` | 1200×900 | Commons, optional |

- Rules:
  - Never upscale: the source's native resolution must cover the 2× output.
  - Choose Sentinel-2 scenes with cloud cover under 10%, newest first.
  - Every source's licence and attribution goes into `CREDITS.md`.
  - Data points come from `photon/src/datacentres.ts` and the fixed capital coordinates.
  - Document tiles use `photon/data/snapshot/passages.json` when it exists, and fall back to the fixture otherwise.

- [ ] **Step 1: Write failing tests** for the pure helpers. Examples:
  - `thermalRamp(0)` is deep blue and `thermalRamp(1)` is amber.
  - Under `orthographic`, the antipode is not visible.
  - `bboxToTiles` returns the known tile for Sacramento at z10.
  - `credits` lists every licence exactly once.

  Also write a manifest test: when `photon/public/landing/img/` exists, every `IMAGE_SET` entry has 1× and 2× files at the stated pixel size and within the byte budget (≤ 300 KB tiles, ≤ 500 KB backgrounds).
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Then run `NODE_USE_ENV_PROXY=1 pnpm landing:images`.
- [ ] **Step 4: Look at every image.**
  - Build a contact sheet PNG at `.tmp-landing/contact-sheet.png` with Playwright or sharp, placing ATMO's `home-vp-00-y0.png` hero beside our tiles. Read it.
  - Redo any tile that looks flat, noisy, blurry, seamed, cloud-covered or off-palette.
  - Record your per-image notes in the report.
- [ ] **Step 5:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 6: Commit.** Message: "Generate the landing imagery from open satellite, elevation and globe data."
- [ ] **Quality gate (controller):** after task review, a separate vision reviewer on the most capable model rates each image "would pass on atmo.ai" or "redo" from the contact sheet. Every "redo" goes back to the implementer before Task 4 starts.

---

### Task 4: Landing shell: tokens, nav, hero mosaic, mobile hero; capture and compare tooling

**Files:**
- Create: `photon/public/landing.css`, `photon/public/landing.js`, `photon/scripts/landing/capture.ts`, `photon/scripts/landing/compare.ts`
- Modify: `photon/public/index.html` (the real landing markup for nav + hero, plus empty `<section>` stubs for the remaining sections), `package.json` (scripts `landing:capture`, `landing:compare`)

**Interfaces:**
- `capture.ts`, run as `pnpm landing:capture [--base http://localhost:8787]`:
  - Writes `.tmp-landing/shots/{full-1440,full-390,vp-1440-*}.png`.
  - Writes `.tmp-landing/computed-{1440,390}.json` with the same role keys as ATMO's `home-computed-*.json`. The implementer reads that file to learn its keys.
- `compare.ts`, run as `pnpm landing:compare`:
  - Prints a table of role / property / ATMO value / ours / OK.
  - Tolerance: ±1px for sizes and spacing; exact for grid templates and hairline width.
  - Colours and font-family are excluded, since those are deliberate changes.
  - It exits non-zero on any mismatch outside tolerance.
- `landing.js` (ES module):
  - `fillHero(data: LandingData)`.
  - `initNav()`: hide on scroll-down, show on scroll-up.
  - `initHeroCrossfade()`.
  - Each module is a named export, with `init()` wiring them on DOMContentLoaded.

- [ ] **Step 1: Build.** Write the nav and hero markup, the CSS tokens and grid, the mobile hero (3 columns, per the teardown), the readout cells (arrows plus mono lines), the title cell with the H1 and continuation copy verbatim, and the CTA.
- [ ] **Step 2: Capture.** Run `pnpm exec wrangler dev` with the fixture seeded, then `pnpm landing:capture`.
- [ ] **Step 3: Compare.** Run `pnpm landing:compare`. Expected: no mismatches for nav and hero roles. Iterate until clean.
- [ ] **Step 4: Visual check.** Read `.tmp-landing/shots/vp-1440-0.png` next to the reference `home-vp-00-y0.png`, and `full-390` next to `home-full-390.png`. List the differences in the report and fix every structural one.
- [ ] **Step 5: Commit.** "Build the landing nav and hero mosaic to the ATMO grid."

---

### Task 5: Remaining sections, data fill, motion

**Files:**
- Modify: `photon/public/index.html`, `photon/public/landing.css`, `photon/public/landing.js`
- Create: `tests/landing/landing-fill.test.ts` (pure functions only)

**Interfaces:**
- Produces these pure functions in `landing.js`, unit-tested:
  - `formatCoord(lat: number, lng: number): [string, string]` → `["38.5766° N", "121.4934° W"]`.
  - `readoutLines(landmark, place): string[]` → `[lat, lng, PLACE, "SB 53 · ENACTED 2025"]`, uppercased. When the landmark is missing, it returns only the coordinates and the place.
  - `changeRow(item)` → `{ title, meta, href: "/ask?q=Explain%20<shortTitle or title>" }`.
  - `countsMatrix(counts): string[][]`, a 9×7 grid of strings mixing real counts and arrows. With zero counts it returns `[]`.
- DOM wiring:
  - `fillAll(data)`.
  - `initTabs()`: IntersectionObserver over 3 markers toggling `.active`.
  - `initAskField()`: submit goes to `/ask?q=`.
  - A reduced-motion guard.
- Sections 3–8 are built per spec §3, verbatim copy. Mobile layouts follow the teardown §7.

- [ ] **Step 1: Write failing tests** for the 4 pure functions, including the missing-landmark and zero-count cases and a 300-char title in `changeRow`.
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the sections and the fill code. Then check in the browser:
  - `pnpm landing:capture` and `pnpm landing:compare` run clean for every role.
  - With D1 unseeded (fresh `--persist-to .tmp-empty`), the page has no `undefined`/`NaN` text and the data rows are hidden.
  - Under `page.emulateMedia({ reducedMotion: "reduce" })`, `document.getAnimations().length === 0`.
  - A long-title fixture row doesn't overlap the ↗ (bounding boxes don't intersect).
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit.** "Build the landing sections and fill them from the snapshot."

---

### Task 6: Fidelity, accessibility, performance pass

**Files:**
- Create: `photon/scripts/landing/audit.ts` (`pnpm landing:audit`)
- Modify: landing files, only to fix what the audit finds

**Interfaces:**
- `audit.ts` runs Playwright against `wrangler dev` and asserts:
  - 390px: `scrollWidth === clientWidth` on every section.
  - Exactly one `h1`.
  - Every `img` has an `alt` attribute.
  - Body text contrast ≥ 4.5:1: compute from computed `color` and `background-color` for `p` elements.
  - A keyboard tab walk reaches the nav links, the hero CTA, the 3 tabs, the ask field and the footer links, with a focus outline width > 0.
  - LCP < 2,500 ms with `Network.emulateNetworkConditions` set to 4G (CDP).
  - `landing.js` ≤ 12 KB.
  - It prints PASS/FAIL per check and exits non-zero on any FAIL.

- [ ] **Step 1:** Write `audit.ts` and run it. Record the failures.
- [ ] **Step 2:** Fix each failure in the landing files.
- [ ] **Step 3: Re-run all checks.**
  - `pnpm landing:audit` → all PASS.
  - `pnpm landing:compare` → clean.
  - `pnpm test` → PASS.
- [ ] **Step 4: Visual side-by-side.**
  - Capture fresh shots.
  - For each of the 8 sections, Read our viewport shot and the matching ATMO reference shot. List the structural differences (grid, spacing, type scale, element placement), not the deliberate palette, font or imagery changes.
  - Fix the differences, then capture again.
- [ ] **Step 5: Commit.** "Pass the landing page accessibility, performance and fidelity audit."
