# ULIX — orientation

Read this first. It exists so you do not have to explore the repo to find your bearings.

**What it is.** ULIX is a logistics control tower built **on top of** India's Unified
Logistics Interface Platform. Ten modules over a simulated ULIP gateway, built against the
real published specification.

**Brand.** Mark and wordmark live in `src/components/Logo.tsx`. The mark is three streams
merging into one heavier trunk — what comes out is more than what went in. Icons in
`public/` are generated from the same geometry.

**The name sits close to ULIP on purpose, which puts an obligation on us:** ULIX is
independent software, not a government service and not affiliated with NICDC or DPIIT.
The login and settings screens state that. Keep those statements wherever a user could
reasonably wonder whether they are looking at an official platform.

```bash
npm run dev            # app on :5173
node server/ulip-proxy.mjs   # optional; needs ULIP_USERNAME + ULIP_PASSWORD
npx tsc --noEmit -p tsconfig.app.json   # the check to run before claiming done
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
  ulip/           catalogue.ts (generated), envelope.ts, client.ts
  mock/           index.ts = MockAdapter (771 lines, the busiest file), generate.ts, seed.ts
  fusion.ts       cross-system signals — the core idea of the product
  cases.ts        case model; caseStore.ts = shared (proxy) or local storage
  roles.ts        role lens — what each org type is shown first, and why
  osint.ts        live AQI → GRAP eligibility, corridor weather
  disruptions.ts  GDELT filter pipeline    vessels.ts  AIS
  routes.ts       lane planning    scenarios.ts  drill    exim.ts    waterways.ts
  counterparty.ts due diligence
src/pages/        one file per module, lazily routed in App.tsx
src/components/   Shell (nav), NetworkMap, charts.tsx (inline SVG), cases.tsx, ui.tsx
server/ulip-proxy.mjs   credentials, OSINT feeds, shared case store
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
- **The ULIP envelope lies.** A missing record returns **HTTP 200** with `error: "false"`
  and reports failure on the *inner* `responseStatus`. Use `unwrap()` / `isNotFound()`.
  `error` and `code` are strings, not a boolean and a number.
- **FASTag retains 72 hours only.** Anything longer is platform-stored history and must be
  labelled as such.
- **GRAP curbs entry, not delivery** — match consignments routing *through* the NCR.
- **Bridge clearance is lowest in monsoon**, because it is measured to the water. The season
  with the most depth has the least headroom.
- **`dns.setDefaultResultOrder('ipv4first')`** in the proxy. GDELT publishes unreachable
  AAAA records; without it you get a bare `UND_ERR_CONNECT_TIMEOUT` that looks like downtime.
- **Calibrate generated data.** Three screens have shipped flagging *everything* — zero
  clear counterparties, one navigable month a year, overdue permanently zero. A screen that
  flags everyone trains people to ignore it. After generating, check the distribution.

---

## Deployment

Static SPA, hash-routed, no rewrite rules needed. `vercel.json`, `netlify.toml` and a
Pages workflow are committed; `VITE_BASE=/sub/` handles subpath hosting and the manifest
and service worker already use relative URLs. Full notes in `DEPLOYMENT.md`.

On a static deploy the live air-quality and weather feeds still work (Open-Meteo is
HTTPS and CORS-open, fetched from the browser). GDELT, AIS and the shared case queue need
the proxy and degrade to their labelled fallbacks.

## Known limitations

- Case work is shared through the proxy when it is running, and per-browser otherwise.
- GDELT and AIS fall back to labelled simulated sets.
- 53 of 95 endpoints are wired. The rest are thin: GatiShakti ×5, India Post ×4, IWAI
  statistics ×7, and near-duplicates (Telangana VAHAN/SARATHI, fuel-station *registration*
  endpoints, chassis/engine VAHAN lookups).
