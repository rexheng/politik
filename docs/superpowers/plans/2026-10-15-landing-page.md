# ATMO-Style Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a landing page at `/` that copies atmo.ai's layout, type scale and motion. It uses Politik's palette and original thermal/document tiles, and every fact on it comes from the D1 snapshot. The chat app moves to `/ask`.

**Architecture:**
- Static `index.html` + `landing.css` + `landing.js` (an ES module with no dependencies).
- Data comes from a new Worker route, `GET /api/landing`, built only from store functions.
- Tiles are pre-generated SVG assets, made by a repo script from public-domain Natural Earth outlines.
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
- No jQuery, GSAP, Lottie, frameworks or third-party photos. `landing.js` ≤ 12 KB. Each tile ≤ 120 KB.
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

### Task 3: Tile generator and assets

**Files:**
- Create:
  - `photon/scripts/landing/tiles.ts`
  - `photon/scripts/landing/outlines/` (Natural Earth 1:10m admin-1 California and admin-0 Singapore, simplified, as GeoJSON, with `SOURCE.md` naming Natural Earth as public domain)
  - `photon/public/landing/tiles/*.svg`
  - `tests/landing/tiles.test.ts`
- Modify: `package.json` (add the script `"landing:tiles": "tsx photon/scripts/landing/tiles.ts"`)

**Interfaces:**
- Produces: `renderTiles(outDir: string, opts?: { seed?: number }): Promise<string[]>`. It returns the written file paths. Output is deterministic for a given seed. It writes:
  - `ca-thermal.svg`, `sg-thermal.svg`: the outline filled by an `feTurbulence` field mapped through a thermal ramp (deep blue → violet → magenta → amber).
  - `ca-relief.svg`, `sg-relief.svg`: an alternate palette for the crossfade partner.
  - `doc-heat-1.svg` … `doc-heat-4.svg`: about 8 lines of passage-like DM Mono text with thermal highlight bands. The text comes from `tests/fixtures/snapshot/passages.json` by default, or from `photon/data/snapshot/passages.json` when it exists.
  - `globe.svg`: a 640×640 dotted orthographic globe centred to show both California and Singapore, with glow at both.
  - `globe-sources.svg`, `globe-verified.svg`, `globe-answers.svg`: the overlays.
  - `mission-bg.svg`, `ask-bg.svg`: full-bleed thermal fields.
- Projection, simplification and noise parameters are the implementer's choice. The result must read as ATMO-like forecast renders: compare against `home-vp-00-y0.png`.

- [ ] **Step 1: Write failing tests.**
  - `renderTiles` into a temp dir writes every file named above.
  - Each file parses as XML (a minimal well-formedness check: balanced tags via a small parser or `DOMParser` from a light dependency) and starts with `<svg`.
  - Each file is ≤ 120 KB.
  - Two runs with the same seed give identical bytes.
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Then run `pnpm landing:tiles` and look at each tile: render it to PNG with Playwright and Read the PNG.
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit.** "Generate original thermal and document tiles for the landing page."

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
