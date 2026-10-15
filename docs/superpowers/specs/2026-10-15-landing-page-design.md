# Landing page (ATMO-style): design

Status: decided 2026-10-15 (owner delegated the remaining calls to the orchestrator)
Sub-project C of 3. It reads live counts and records from A's store. It links into B's chat.

## 1. Goal

Today a first-time visitor lands on a bare 3-field form. Politik needs a landing page that explains the product in seconds. The owner asked for the design of https://www.atmo.ai/ "almost exactly pixel by pixel", with Politik's own stylistic choices.

The reference teardown (screenshots, computed styles, CSS, IX2 data) is in the session scratchpad `atmo/` folder:
- `atmo/shots/*.png`: 1440 and 390 full-page and viewport shots.
- `atmo/shots/home-computed-*.json`: computed styles.
- `atmo/raw/site.css`, `atmo/site_rules_flat.txt`: the CSS.

The implementer copies the reference shots they need into `.tmp-landing/reference/` (git-ignored).

## 2. What we copy exactly, and what we change

**Copied, measured from ATMO:**
- **Layout system:**
  - Full-bleed panels ruled by **0.75px hairlines**. No cards, no radius, no shadows. The one exception is the frosted panel, with a 5px radius.
  - A 40px edge gutter.
  - The 1:2 column (480/960 at 1440) and 1.5:1 row ratios.
  - Sections exactly 100vh where ATMO's are.
- **Hero mosaic:**
  - 5 columns at fractions 1.5 / 2.5 / .75 / 1 / 1.5 and 4 rows at .5 / .75 / 1 / .5, no gaps.
  - The hero is 95vh tall with a 3.1rem top margin.
  - 8 image tiles, 6 readout cells and 2 empty cells.
  - The title cell spans 2×2 at the bottom-left.
- **Type scale, all weight 400:**

  | Role | Size / line-height | Tracking |
  |---|---|---|
  | H1 | 50 / 1 | −1.5px |
  | H2 large | 40 / 1 | −0.8px |
  | Statement | 30 / 1.1 | −0.6px |
  | H2 section | 24 / 1.1 | −0.48px |
  | Sub | 20 / 1.3 | −0.44px |
  | Body | 15 / 1.2 | normal |
  | Mono labels, nav, CTAs | 12 / 1.2 | −0.12px |
  | Arrows | 40px glyphs | |

- **Motion:**
  - The nav hides on scroll-down and reappears on scroll-up (translateY, 800ms ease).
  - Hero tiles crossfade (opacity 1.2s) in three staggered groups at 3s / 8s / 13s, looping every 15s.
  - Sticky tabs fade with opacity 1.5s. Tab colour transitions take 0.3s.
  - On hover, arrows nudge: translateX(5px) over 0.25s, or translate(3px, −3px) over 0.3s on CTAs.
  - There is no parallax, no marquee and no counters.
- **Mobile at 390px:** the same behaviour as ATMO, per the teardown.
  - The hero becomes a 3-column mosaic.
  - The sticky scroll is replaced by stacked blocks.
  - Grids stack. Text drops to 22–24px.
  - The nav shows the logo plus one link.

**Changed (Politik's choices):**
- **Fonts:**
  - Denim INK is commercial, so we use **Inter Tight 400** with matching negative tracking.
  - **DM Mono** is used as-is.
  - Both load from Google Fonts.
- **Palette:** ATMO's structure in Politik's existing colours.

  | ATMO | Politik | Token |
  |---|---|---|
  | #000000 | `#0f0d0b` warm ink | `--ink` |
  | #FFFFFF | `#f6f1e7` cream | `--paper` |
  | #D8D4AC vanilla | `#e9dfc6` | `--vanilla` |
  | #EBD400 yellow | `#e8c468` Politik gold | `--accent` |
  | #9E9E9E | `#9e9a92` | `--granite` |
  | #787878 | `#7a766f` | `--muted` |

  Colours are defined as CSS custom properties on `:root`.
- **Imagery:** real, high-quality raster images, never vector "art". This was revised 2026-10-15 at the owner's request: no SVG noise fills, clip-art, or gradients standing in for images. ATMO pairs real photos with real forecast renders of the same place, and we do the same with open-licensed sources.
  - **Satellite photos:** Copernicus Sentinel-2 true colour at 10 m, from the public Sentinel-2 COGs on AWS (found via the Earth Search STAC API). Pick low-cloud scenes and crop to:
    - the State Capitol and downtown Sacramento
    - Silicon Valley / Santa Clara data-centre land
    - Singapore's Civic District and Marina Bay
    - Singapore's Jurong / Tuas data-centre parks
    - Attribution: "Contains modified Copernicus Sentinel data 2026".
  - **Data renders:** each pairs with a satellite tile as its crossfade partner, like ATMO's photo ↔ forecast. They are drawn from real data:
    - shaded relief from AWS Terrain Tiles elevation (Terrarium)
    - coloured with the thermal ramp (deep blue → violet → magenta → amber)
    - overlaid with real points from our data: data-centre sites from `photon/src/datacentres.ts`, plus the capitals as policy pins
  - **Globe:** NASA Blue Marble (public domain) on an orthographic projection showing California and Singapore, with a thermal glow at both.
  - **Photography (optional, up to 2 tiles):** Wikimedia Commons images under CC0, public domain or CC BY / BY-SA (e.g. the California State Capitol, Parliament House Singapore), with attribution.
  - **Document heat tiles:** real snapshot passages typeset in DM Mono with thermal highlight bands. They are rendered to raster through a headless-browser screenshot, so the text is crisp.
  - **Format:** every image is WebP at 2× its largest display size, with `srcset` 1×/2×. Hero and section tiles ≤ 300 KB, full-bleed backgrounds ≤ 500 KB.
  - **Source and credits:** a repo script `photon/scripts/landing/images/` produces all images reproducibly. Every source and licence goes in `photon/public/landing/CREDITS.md`, and the footer shows a short "Imagery:" credit line.
  - These replace ATMO's photo ↔ forecast crossfade with a document ↔ heat-map crossfade of the same subject.
- **Voice:** ATMO's instrument/telemetry tone, applied to policy. For example: `38.5766° N / 121.4934° W / SACRAMENTO / SB 53 · ENACTED 2025`.
- **No invented facts.** Every number, status and date on the page comes from `/api/landing`, which reads the D1 snapshot. If the API fails, the readouts show coordinates and place names only.

## 3. Sections (top to bottom; heights at 1440)

1. **Nav** (fixed, 51px, ink, 0.75px paper hairline at the bottom).
   - "Politik" wordmark on the left.
   - Links in DM Mono 12px: How it works · Coverage · What changed · Sources, plus "Ask Politik ↗" with a gold underline.
2. **Hero mosaic** (95vh).
   - 6 readout cells. Each has an arrow pointing at its neighbouring tile and an uppercase mono readout: coordinates / place / record short title / status · year. They are filled from `landmarks` in `/api/landing`.
   - 2 of the readouts are jurisdiction totals, e.g. `36.7783° N / 119.4179° W / CALIFORNIA / 126 RECORDS`.
   - Title cell:
     - H1 in paper: "Policy intelligence, cited."
     - Grey continuation: "Ask what's changing in California and Singapore tech policy — every answer traced to its source."
     - Mono CTA: "Ask Politik ↗" → `/ask`.
3. **How it works** (300vh, sticky 100vh panel, 1fr/2fr).
   - Tab index on the left, gold when active:
     - → Sources: "{records} records from {publishers} official publishers".
     - → Verified: "Every claim is checked against the passage it cites; {reviewed} landmark records human-reviewed".
     - → Answers: "Brief me · Explain this · What it means".
   - Each tab has a 24px H2 and a 15px body.
   - The visual on the right is a 640×640 display (1280×1280 WebP) Blue Marble orthographic globe with California and Singapore glowing in thermal colours.
   - A per-tab overlay fades in on top. Overlays are crisp HTML/CSS elements, not images, so they stay sharp:
     - Sources: source dots.
     - Verified: check marks with the "{reviewed} REVIEWED" stat.
     - Answers: a mini answer card with [1][2] chips.
   - Tabs switch with IntersectionObserver on three 100vh markers. No GSAP.
4. **Ask section** (100vh, full-bleed).
   - The background is an animated thermal field (CSS or canvas, paused under reduced motion).
   - A frosted panel (`rgba(177,177,177,.35)`, blur 10px, radius 5px, inset 40px) holds:
     - On the left, mono "Answers in seconds" and a 40px H2: "Brief me. Explain this. What does it mean?"
     - On the right, a 15px paragraph and an inline ask field (mono, underline style). Submitting goes to `/ask?q=<text>`.
5. **Mission** (100vh, full-bleed thermal background, grid 2fr/1fr × 1.5fr/1fr).
   - Top-left: an arrow, then a 30px paragraph. The paper-coloured lead sentence is "Policymakers shouldn't need to read 400 pages to know what changed." The muted continuation is "Politik reads the official sources and shows its work."
   - Bottom-left: a wall of the snapshot's publisher names in mono 15px, replacing ATMO's logo wall.
   - Bottom-right: a thermal tile with a mono coordinate caption.
6. **Method** (100vh, vanilla, ink text, grid 1fr/2fr × 1.5fr/1fr).
   - Top-left: 30px statement "No invented facts. Every sentence points to a source."
   - Top-right: a document heat tile.
   - Bottom-left: a 9×7 mono matrix of the real counts by type and jurisdiction, with arrows.
   - Bottom-right: stacked mono links: Sources →, Map →, Categorisation →, "Data as of {date}".
7. **What changed** (vanilla, padding-top 100px). This is ATMO's careers list.
   - Header: "→ What changed" at 50px.
   - Up to 8 rows from `latest`: the title at 30px; jurisdiction · status at 20px; a 12px date meta line; a ↗ that links to `/ask?q=Explain <shortTitle or title>`.
   - Rows are separated by full-bleed 0.75px ink hairlines, with padding 60/80.
8. **Footer** (gold background, ink text, 3 × 480 columns with ink hairlines).
   - Column 1: "Politik", the tagline "Built for people who make tech policy in California and Singapore", and the wordmark pushed to the bottom.
   - Column 2: Coverage & method links.
   - Column 3: "Ask Politik ↗".
   - Bottom row: "© 2026 Politik · Data as of {date}" on the left, links on the right.

## 4. Routes & integration

- `/` serves the landing page (`photon/public/index.html` becomes the landing page, with `landing.css` and `landing.js`).
- The chat app moves to `/ask` (`photon/public/ask.html`, using the existing `app.js` and `app.css`).
  - Every page's tab nav gets "Ask" → `/ask` and a "Politik" home link → `/`.
  - `manifest.webmanifest` `start_url` becomes `/ask`, so the installed PWA opens the app.
  - `sw.js` shell assets are updated and the cache version bumped.
- `app.js` reads `?q=` on load, auto-submits it once, and then removes it from the URL.
- New Worker route `GET /api/landing`, returning:
  ```ts
  { asOf: string; counts: { records: number; byJurisdiction: Record<Jurisdiction, number>; byType: Record<RecordType, number>; publishers: number; reviewed: number };
    publishers: string[];
    landmarks: { shortTitle?: string; title: string; jurisdiction: Jurisdiction; status: Status; statusDate?: string; url: string }[];  // ≤ 4, newest lastActivity first
    latest: { date: string; event: string; record: { id: string; title: string; shortTitle?: string; jurisdiction: Jurisdiction; status: Status; url: string } }[] }  // ≤ 8
  ```
  - It is built only from `listRecords`, `recentChanges` and `getManifest`.
  - Header: `cache-control: public, max-age=300`.
  - When D1 is empty, it returns zeros and empty lists, and the page hides the data-driven rows.
- Fixed coordinates, in `landing.js`:
  - Sacramento (State Capitol): 38.5766° N, 121.4934° W
  - Singapore (Parliament House): 1.2894° N, 103.8505° E
  - California centroid: 36.7783° N, 119.4179° W
  - Singapore centroid: 1.3521° N, 103.8198° E

## 5. Quality bar

- **Fidelity:**
  - Playwright captures the landing page at 1440×900 and 390×844 (full page and per viewport) into `.tmp-landing/shots/`.
  - A script dumps computed styles for the same roles ATMO's JSON has (nav, h1, h2, body, labels, section paddings).
  - A comparison script, `photon/scripts/landing/compare.ts`, prints mismatches against these targets. Tolerance: ±1px on sizes and spacing, and exact match on grid fractions and hairline width.
  - A vision-capable reviewer compares our screenshots with ATMO's, section by section.
- **Performance:**
  - No jQuery, GSAP or Lottie.
  - `landing.js` is 12 KB or less unminified.
  - Images are WebP at 2×, lazy-loaded below the fold. Hero/section tiles ≤ 300 KB; backgrounds ≤ 500 KB.
- **Image quality gate:**
  - A contact sheet of every generated image goes next to ATMO's hero tiles.
  - A vision-capable reviewer on the most capable model rates each image "would pass on atmo.ai" or "redo".
  - Every "redo" is regenerated before the landing page ships.
  - Banned: vector noise fills, clip-art, flat gradient placeholders, upscaled low-resolution sources (source resolution must meet the 2× size), visible tile seams, and watermarks.
  - LCP under 2.5s on a throttled 4G Playwright run.
- **Accessibility:**
  - One `h1`. Tiles are decorative (`alt=""`) unless they carry meaning.
  - Contrast is at least 4.5:1 for body text.
  - Visible focus styles. Every link and tab is reachable by keyboard.
  - `prefers-reduced-motion` disables the crossfades, the thermal animation and the nav hide.
- **Tests (`pnpm test`):** `/api/landing` against the A fixture (counts, landmarks, latest ordering, empty-D1 case); the image generator's pure helpers (colour ramp, projection, crop maths, credits list) are correct, and every expected output image exists at its required pixel size and byte budget; and `?q=` handling in `app.js` is pinned by a small DOM-free unit (`readInitialQuestion(url)`).
