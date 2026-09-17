# ULIX — orientation

Read this first. It exists so you do not have to explore the repo to find your bearings.

**For the full picture — terminology, how the domain concepts join, every module's
function, and every trap paid for — read [knowledge-base.md](knowledge-base.md).** This
file is the short operational brief; that one is the reference underneath it.

**What it is.** ULIX is a logistics control tower built **on top of** India's Unified
Logistics Interface Platform. Eleven modules over a simulated ULIP gateway, built against the
real published specification.

**Brand.** Mark and wordmark live in `src/components/Logo.tsx`. The mark is three streams
merging into one heavier trunk — what comes out is more than what went in. Icons in
`public/` are generated from the same geometry.

**The name sits close to ULIP on purpose, which puts an obligation on us:** ULIX is
independent software, not a government service and not affiliated with NICDC or DPIIT.
The login and settings screens state that. Keep those statements wherever a user could
reasonably wonder whether they are looking at an official platform. `NOTICE` carries the
same statement for anyone who takes the **code** rather than uses the app — Apache-2.0
requires NOTICE to travel with redistributions, which is the main reason that licence was
chosen over MIT. Licence is Apache-2.0; `LICENSE` is the canonical text, unmodified apart
from the copyright line.

```bash
npm run dev            # app on :5173
npx tsx scripts/conformance.ts   # mappers vs the documented response samples
node server/ulip-proxy.mjs   # optional; needs ULIP_USERNAME + ULIP_PASSWORD
                             # cases persist to server/data/cases.db (SQLite)
npx tsc --noEmit -p tsconfig.app.json   # the check to run before claiming done
npx tsc --noEmit -p tsconfig.api.json   # api/ — and tsconfig.scripts.json for scripts/
vercel build --prod          # REQUIRED after touching api/; tsc does not see what Vercel does
npm run build
```

---

## Do not read these

| Path | Why not |
|---|---|
| `docs/ulip-api/pdf/` | 24 MB of source PDFs |
| `docs/ulip-api/txt/` | 1.3 MB extracted text |
| `src/data/ulip/catalogue.ts` | 918 generated lines — grep it, do not read it whole |

Everything those files contain is already in the catalogue, and
`docs/ulip-api/INDEX.md` maps each endpoint family to the one document that answers a
question about it. Reach for a document only when adding a new endpoint family.

---

## Three kinds of data, never conflate them

1. **Specification — real.** 95 endpoint codes, parameters, regexes, base URLs, auth flow,
   response envelope. Extracted verbatim from the official documents.
2. **ULIP data — simulated.** Consignments, fleet, documents, customs, waterways. Seeded
   PRNG, deterministic, generated relative to the current clock.
3. **Open-source feeds — genuinely live.** Air quality and weather from Open-Meteo.
   GDELT and AIS are wired but need a non-throttled IP / an API key.

The UI marks live panels with a `live` badge and nothing simulated is styled to look live.
Full breakdown in `docs/DATA-PROVENANCE.md`. **Keep that invariant.**

---

## Where things live

```
src/data/
  config.ts       env + proxy URLs. Dependency-free ON PURPOSE (see gotcha below)
  types.ts        domain model
  adapter.ts      DataAdapter — the ONLY interface pages talk to
  index.ts        swap point: mock ⇄ live
  ulip/           catalogue.ts (generated), envelope.ts, client.ts,
                  adapter.ts (live), map.ts (gateway → domain, + FIELD_GAPS)
  mock/           index.ts = MockAdapter (805 lines, the busiest file), generate.ts, seed.ts
  fusion.ts       cross-system signals — the core idea of the product
  quality.ts      detector precision from case outcomes — the feedback loop
  cases.ts        case model; caseStore.ts = shared (proxy) or local storage
  roles.ts        role lens — what each org type is shown first, and why
  gatishakti.ts   corridors, tolls, parks, warehousing — the map's under-layer
  osint.ts        live AQI → GRAP eligibility, corridor weather
  disruptions.ts  GDELT filter pipeline    vessels.ts  AIS
  routes.ts       lane planning    scenarios.ts  drill    exim.ts    waterways.ts
  counterparty.ts due diligence
  importer.ts     CSV → the consignment book ULIP cannot supply
  notify.ts       delivery — which cases leave the browser, and as what
src/pages/        one file per module, lazily routed in App.tsx
src/components/   Shell (nav), NetworkMap, charts.tsx (inline SVG), cases.tsx, ui.tsx
server/ulip-proxy.mjs   credentials, OSINT feeds, shared case store
server/store/           case persistence: sqlite.mjs (default), postgres.mjs,
                        index.mjs picks by DATABASE_URL
```

**Adding a module:** data module in `src/data/` → method on `DataAdapter` → implement in
`MockAdapter` → page in `src/pages/` → lazy route in `App.tsx` → nav entry in `Shell.tsx`
→ **name it in `MODULE_LABEL` and add its path to every role that should see it in
`roles.ts`.** A route missing from `roles.ts` renders fine but appears in nobody's
sidebar, which looks exactly like a broken route.

---

## Conventions

- **Pages never fetch.** Everything goes through `adapter`. That is what makes the live
  swap a config change rather than a rewrite.
- **Charts are inline SVG** in `components/charts.tsx`. A charting library was removed —
  it shipped 370 kB to draw one illegible bar chart. Do not add one back.
- **Styling** is Tailwind v4 with semantic tokens (`bg-surface`, `text-muted`, `border-line`)
  defined in `index.css`. Never hard-code a colour; both themes resolve through the tokens.
- **Roles are a lens, not access control.** `roles.ts` decides what each org type sees
  first — nav order and membership, which signals sort to the top of the queue, which
  single number leads the tower, and what each module opens on. It filters no records:
  every route still resolves by URL and every signal stays in the queue. Say so wherever
  it shows.
- **Tables render from a column registry.** `SHIPMENT_COLUMNS` and `FLEET_COLUMNS` define
  one entry per column and the lens picks the list, so a new column is a registry entry,
  not an edit to a `<thead>` and three `<Td>` runs. Columns are a weaker lens than rows —
  a column left out is still in the record drawer — so they get no banner, but every
  field one role leads with MUST be reachable in the drawer. Check that before dropping
  one from a set.
- **A lensed default must be visible and reversible.** If the filter has a visible
  control (a tab, a Select), that control *is* the disclosure — set it and stop. If it
  does not, render `<LensDefault>` with a one-click way out. A silently pre-filtered
  table is indistinguishable from missing data.
- **Name things once.** Module names live in `MODULE_LABEL` (`roles.ts`) and signal
  names in `SIGNAL_LABEL` (`fusion.ts`), both keyed exhaustively. Do not re-declare
  a label in a page.
- **Comments explain why, not what.** Most existing comments record a decision or a trap.
- Everything must work at 375 px. Sidebar on desktop, four tabs + a More sheet on mobile.

---

## Gotchas that have already cost time

- **`config.ts` must stay dependency-free.** It used to live in `data/index.ts`, which also
  constructs the adapter — so anything the adapter imported could not read it, and the app
  died at load with *"Cannot access 'OSINT_BASE' before initialization"*.
- **ULIP is a lookup API, not a list API.** Every endpoint is keyed by an identifier you
  already hold — a vehicle number, an e-Way Bill number, an FNR. Nothing answers "what am
  I shipping today". The live adapter is therefore an ENRICHMENT layer over a consignment
  book that must come from a TMS or ERP, and everything needing that book throws
  `NotWiredError` with the reason rather than returning an empty array.
- **Never fail open on a restriction.** `ncrEligibility` used to default an unparseable
  emission norm to BS-VI, so a real VAHAN record — which spells it `BHARAT STAGE II`, not
  `BS-II` — was read as the cleanest possible vehicle and waved into Delhi at GRAP Stage
  IV. Unknown now means restricted.
- **The ULIP envelope lies.** A missing record returns **HTTP 200** with `error: "false"`
  and reports failure on the *inner* `responseStatus`. Use `unwrap()` / `isNotFound()`.
  `error` and `code` are strings, not a boolean and a number.
- **FASTag retains 72 hours only.** Anything longer is platform-stored history and must be
  labelled as such. `onset()` in `fusion.ts` floors every signal's age at that horizon on
  purpose — it is the platform's own visibility window, not a FASTag detail. Unfloored,
  cases present as weeks old. Do not "fix" it.
- **GRAP curbs entry, not delivery** — match consignments routing *through* the NCR.
- **Bridge clearance is lowest in monsoon**, because it is measured to the water. The season
  with the most depth has the least headroom.
- **`dns.setDefaultResultOrder('ipv4first')`** in the proxy. GDELT publishes unreachable
  AAAA records; without it you get a bare `UND_ERR_CONNECT_TIMEOUT` that looks like downtime.
- **A generated status and a generated timetable must be reconciled.** `makeShipments`
  drew both independently and never compared them, which produced consignments that were
  `planned` with a departure weeks in the past, and ETAs behind the clock on most of the
  book. Anything comparing a date against `eta` was then comparing against nothing. The
  schedule is re-anchored to the clock after progress is known; keep it that way.
- **The case store is compare-and-set, and a driver that loses that is not a case
  store.** `put(signalId, record, ifVersion)` compares and writes inside one
  transaction; a stale pin returns the current record rather than overwriting. That
  contract is the only reason a queue can be shared. `node:sqlite` prints an
  ExperimentalWarning on startup — the proxy explains it so it does not read as a fault.
- **Delivery sends little enough, or it is another thing to ignore.** `notify.ts` sends
  criticals and cases past SLA with no owner, at most ten per message, and **never the
  same case twice** — signals are recomputed on every read, so without that guard a poll
  would re-send the same conflict forever. The mark rides on the case activity trail, so
  it is de-duplicated and auditable in one move. Only cases actually LISTED are marked;
  marking an omitted one would silence a conflict nobody saw. The webhook URL lives on
  the proxy and never reaches the browser.
- **A detector's track record is a feature, not an afterthought.** `quality.ts` turns the
  `Resolution` an operator picks into precision per signal kind, and a weak detector is
  marked on the case row. The category's documented failure is alert fatigue: operators
  mark things false-positive and nothing ever changes. Never add a detector without
  asking how its precision will be measured.
- **Vercel compiles `api/` with its own settings, reports errors, and ships anyway.** It
  resolves as nodenext (so relative imports need explicit `.js` extensions), has no node
  types (`process.env` errors — reach it through `globalThis`), and compiles without
  strict (discriminated unions stop narrowing). Ignoring that deployed a function that
  500'd on every request while the workflow stayed green. Run `vercel build --prod`
  locally after touching `api/`; a passing `tsc` does not mean the function runs.
- **Calibrate generated data.** Three screens have shipped flagging *everything* — zero
  clear counterparties, one navigable month a year, overdue permanently zero. A screen that
  flags everyone trains people to ignore it. After generating, check the distribution.

---

## Deployment

Static SPA, hash-routed, no rewrite rules needed. `vercel.json` and `netlify.toml` are
committed; `VITE_BASE=/sub/` handles subpath hosting and the manifest and service worker
already use relative URLs. Full notes in `DEPLOYMENT.md`.

`vercel --prod` deploys by hand. Pushes to `main` deploy through
`.github/workflows/deploy.yml`, which builds on GitHub and hands the output to Vercel over
the CLI. Vercel's own Git integration is **not** available: it needs a paid team plan and
this project sits in a team scope, which the CLI reports as an unhelpful
`POST /v9/projects/{id}/link → 400` blaming the repository. Do not spend time retrying
`vercel git connect`.

On a static deploy the live air-quality and weather feeds still work (Open-Meteo is
HTTPS and CORS-open, fetched from the browser). GDELT, AIS and the shared case queue need
the proxy and degrade to their labelled fallbacks.

## Known limitations

- Case work is shared through the proxy when it is running, and per-browser otherwise.
  The proxy persists to SQLite (`server/data/cases.db`); a Postgres driver exists for
  running without a disk but has never been pointed at a real database.
- GDELT and AIS fall back to labelled simulated sets.
- 58 of 95 endpoints are wired. The rest are thin: India Post ×4, IWAI statistics ×7,
  and near-duplicates (Telangana VAHAN/SARATHI, fuel-station *registration* endpoints,
  chassis/engine VAHAN lookups).
