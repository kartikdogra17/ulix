# ULIX — knowledge base

Everything a session needs to change this codebase without breaking it. Read this
before touching code. [CLAUDE.md](CLAUDE.md) is the short operational brief;
[HANDOFF.md](HANDOFF.md) is where things currently stand; this is the reference
underneath both.

**Status at the time of writing:** 39 commits, ~15,500 lines across `src/`, `server/`
and `scripts/`. Eleven modules. Typecheck and build clean. Live at
<https://ulip-platform.vercel.app>, and a push to `main` deploys itself. No real
government data has ever flowed through it — see [§10](#10-the-live-integration).

---

## 1. What ULIX is

A logistics **control tower** built on top of India's Unified Logistics Interface
Platform. Eleven modules. It joins data that several government ministries hold separately, finds the
conflicts between them, and turns each conflict into a case somebody owns.

It is **independent software**. It is not a government service and is not affiliated
with NICDC Logistics Data Services or DPIIT. The name sits close to ULIP deliberately,
which is exactly why that disclaimer appears on the login screen, the settings screen
and in `NOTICE`. Keep it wherever a user could reasonably wonder whether they are
looking at an official platform.

---

## 2. Terminology

Nothing here is optional background. The product's whole value is in how these join.

### The platform

| Term | What it means |
|---|---|
| **ULIP** | Unified Logistics Interface Platform. A government API gateway that brokers data from 35 source systems across 17 ministries. Launched Sept 2022 under the National Logistics Policy. Access requires registration on goulip.in, a signed NDA, and per-dataset approval. |
| **NICDC / NLDSL** | National Industrial Corridor Development Corp / its logistics data arm. Operates ULIP. |
| **DPIIT** | Dept for Promotion of Industry and Internal Trade. The ULIP host domain is `ulip.dpiit.gov.in`. |
| **Endpoint code** | ULIP's identifier for one dataset call, e.g. `FASTAG/01`, `VAHAN/01`. Always `SYSTEM/NN`. |
| **Envelope** | ULIP's response wrapper. See the trap in [§8](#8-traps-already-paid-for) — it does not behave the way its field names suggest. |

### The source systems that matter here

| System | Ministry | What it knows |
|---|---|---|
| **FASTag** | Road Transport & Highways | Electronic toll reads. A vehicle's heartbeat. **Retains 72 hours only.** |
| **VAHAN** | Road Transport & Highways | Vehicle registration: fitness, insurance, PUC, emission norm, owner, RC status. |
| **SARATHI** | Road Transport & Highways | Driving licences. Needs a licence number **and** date of birth. |
| **e-Way Bill** | Finance (GSTN/NIC) | The document that legalises a goods movement. Part-A is the consignment, **Part-B is the vehicle**. Has a validity window. |
| **FOIS** | Railways | Freight Operations Information System. Rake movements, keyed by FNR number. |
| **ICEGATE** | Finance (CBIC) | Customs. Bills of entry, shipping bills, out-of-charge. |
| **PCS** | Ports, Shipping & Waterways | Port Community System. Vessel and container events. |
| **LDB** | — | Logistics Data Bank. Container tracking. |
| **GatiShakti** | Commerce & Industry | The National Master Plan: highway corridors and lane status, toll plazas, industrial parks, warehousing. Infrastructure, not movement. |
| **IWAI** | Ports, Shipping & Waterways | Inland Waterways Authority. National Waterways, bridge clearances, terminals. |

### Domain vocabulary

| Term | What it means |
|---|---|
| **Consignment** | One shipment. Called CN in the UI. Has legs, documents, a value, an ETA. |
| **Leg** | One mode-specific stretch of a journey (road / rail / sea / air), with its own from, to, conveyance and planned times. A consignment is multimodal when it has legs of different modes. |
| **Conveyance** | The specific unit on a leg: truck registration, train number, vessel IMO, flight number. |
| **Part-B** | The section of an e-Way Bill carrying the vehicle number. Must be updated on transshipment. When it disagrees with the vehicle actually generating toll reads, something is wrong. |
| **s.129** | Section 129 CGST/SGST — detention and penalty. **Anti-evasion**, so expiry alone does not sustain a penalty; the department must show intent to evade. Courts have quashed penalties for breakdown-caused expiry. Do not overstate this in copy. |
| **GRAP** | Graded Response Action Plan. CAQM's staged air-pollution restrictions for the NCR. Stages 1–4. Higher stages bar older diesel goods vehicles from **entering** Delhi. |
| **CPCB AQI** | Central Pollution Control Board air quality index. Drives the GRAP stage. |
| **BS norm** | Bharat Stage emission standard (BS-II … BS-VI). Determines GRAP eligibility. VAHAN writes it as `"BHARAT STAGE IV"`, **not** `"BS-IV"`. |
| **Detention / demurrage** | Charges accruing while cargo or equipment sits. The clock runs whether or not anyone is working the file. |
| **Reefer** | Temperature-controlled unit. A cold-chain breach is a temperature excursion. |
| **Hazmat** | Hazardous goods, requiring specific clearance to move. |
| **DFC** | Dedicated Freight Corridor. Eastern (Ludhiana–Dankuni) and Western (Dadri–JNPT) are real rail freight corridors. |
| **NHDP corridors** | Golden Quadrilateral, North–South (Srinagar–Kanyakumari), East–West (Porbandar–Silchar). Real highway alignments. |
| **ICD / CFS** | Inland Container Depot / Container Freight Station. Dry ports. |
| **FNR** | Freight Notice Receipt — the rail consignment key for FOIS. |
| **LR / docket** | Lorry Receipt. The road equivalent of a consignment reference. |

---

## 3. The three kinds of data — the central invariant

This is the rule that matters most. Violating it destroys the product's credibility,
which is the most valuable thing it has.

1. **Specification — REAL.** 95 endpoint codes across 35 systems, their parameters,
   validation regexes, examples, base URLs, auth flow and response envelope. Extracted
   verbatim from the 36 official integration documents (726 pages) downloaded from
   goulip.in. Lives in `src/data/ulip/catalogue.ts`, **generated**, 918 lines.
2. **ULIP data — SIMULATED.** Every consignment, vehicle, document, customs file and
   waterway. Seeded PRNG, deterministic, generated relative to the current clock.
3. **Open-source feeds — GENUINELY LIVE.** Air quality and weather from Open-Meteo
   (HTTPS, CORS-open, keyless, works from the browser even on the static deploy).
   GDELT and AIS are wired but unavailable here — GDELT 429s from this egress IP, AIS
   needs a free `AISSTREAM_API_KEY` and forbids browser connections.

**The rules that follow:**

- Only kind 3 may carry a `live` badge.
- Nothing simulated may be styled to look live.
- Where a screen mixes them, it says which is which.
- Full breakdown in [docs/DATA-PROVENANCE.md](docs/DATA-PROVENANCE.md).

---

## 4. The product thesis — how the knowledge relates

The point of ULIP is **not** that you can call `FASTAG/01` and `VAHAN/01` separately.
It is that answers nobody can get from a single ministry fall out when you put them
side by side. That join is the product; everything else is plumbing.

`src/data/fusion.ts` is where it lives. Every signal is a join across two or more
source systems, cites the endpoint codes that produced it, and becomes a case.

**The seventeen signal kinds, and the join behind each:**

| Kind | The join |
|---|---|
| `ewb_expires_before_eta` | e-Way Bill validity (EWAYBILL/01) vs the ETA implied by movement data (FASTAG/01). Neither system knows about the other. |
| `partb_vehicle_mismatch` | The vehicle declared in Part-B vs the vehicle actually generating toll reads. Undeclared transshipment, or worse. |
| `vehicle_dark` | Absence of FASTag reads on an active leg. The heartbeat stopped. |
| `fitness_lapsed` | VAHAN fitness date vs the fact that the vehicle is under load. An enforcement stop detains the cargo, not just the truck. |
| `insurance_lapsed` | Same shape, insurance. |
| `dl_expired` | SARATHI licence validity vs an active driving assignment. |
| `tag_blacklisted` | FASTag status vs a journey that must cross plazas. |
| `tag_low_balance` | FASTag balance vs plazas still ahead on the route. |
| `customs_hold` | ICEGATE status vs a demurrage clock. |
| `hazmat_no_clearance` | Declared hazardous goods vs missing PESO/clearance. |
| `reefer_breach` | Temperature excursion vs commodity requirement. |
| `detention` | Dwell time vs contractual free time. |
| `eta_slip` | Projected arrival vs promised ETA. |
| `grap_entry_ban` | **Live CPCB AQI → GRAP stage → the vehicle's own BS norm and fuel from VAHAN.** Neither CAQM nor ULIP can answer "can this truck enter Delhi today"; together they can. |
| `fog_risk` | Corridor weather vs visibility-sensitive movement. |
| `corridor_disruption` | Open news (GDELT), filtered and placed, vs the consignment's own lane. |
| `corridor_pinch` | **GatiShakti lane status vs the leg that runs over it.** The corridor record does not know your tonnage; the consignment book does not know the lane is still two-lane. |

**Severity** is `critical | high | medium`. **SLA hours** are 4 / 12 / 48 by severity.

**Signals vs cases.** A *signal* is derived and recomputed on every read; it vanishes
when the underlying facts change. A *case* is the human record over it — owner, status,
outcome, audit trail — and persists. They are deliberately separate so an operator's
decision survives a refresh and an auditor can ask who accepted a risk and when.

**Resolutions** (`src/data/cases.ts`) form a taxonomy that feeds detector precision:
`fixed_at_source`, `mitigated`, `risk_accepted` all mean the signal was right;
`false_positive` means the government record was wrong, not the cargo;
`no_longer_relevant` means overtaken by events and is a verdict on neither.

---

## 5. Architecture

### The one rule

**Pages never fetch.** Every screen talks to `DataAdapter` (39 methods) and nothing
else. That is what makes the mock ⇄ live swap a config change rather than a rewrite.

```
src/data/
  config.ts        env + proxy URLs. DEPENDENCY-FREE ON PURPOSE (see §8)
  types.ts         domain model: Shipment, Leg, Vehicle, ComplianceDoc, Org, Session…
  adapter.ts       DataAdapter — the only interface pages talk to (39 methods)
  index.ts         the swap point: selectAdapter() picks mock or live by ULIP_MODE
  fusion.ts        cross-system signals — the core idea (521 lines)
  cases.ts         case model, resolutions, SLA, team
  caseStore.ts     shared (proxy) or per-browser fallback, optimistic concurrency
  quality.ts       detector precision from closed outcomes — the feedback loop
  roles.ts         the role lens: nav, headline, queue ranking, page defaults, columns
  importer.ts      CSV → the consignment book ULIP cannot supply
  notify.ts        delivery — selection rule and payload, pure and testable
  osint.ts         live AQI → GRAP stage → per-vehicle entry eligibility; weather
  disruptions.ts   GDELT filter pipeline
  vessels.ts       AIS positions and port congestion
  gatishakti.ts    corridors, lane status, tolls, parks, warehousing
  waterways.ts     National Waterways, stretches, structures, terminals
  routes.ts        lane planning
  scenarios.ts     scenario drill
  exim.ts          import/export clearance files and demurrage clocks
  counterparty.ts  counterparty due diligence
  ulip/
    catalogue.ts   GENERATED, 918 lines — grep it, never read it whole
    envelope.ts    unwrap(), isNotFound(), UlipError
    client.ts      faithful HTTP client: login, bearer, validate, call
    adapter.ts     UlipAdapter (live) + NotWiredError
    map.ts         gateway records → domain model, + FIELD_GAPS
  mock/
    index.ts       MockAdapter — the busiest file (805 lines)
    generate.ts    the generated world (543 lines)
    seed.ts        PRNG, nodes, carriers, commodities, toll plazas
    gateway.ts     catalogue subscription + call log simulation
```

```
src/pages/       one per module, lazily routed in App.tsx
src/components/  Shell (nav), NetworkMap, charts.tsx (inline SVG), cases.tsx,
                 ui.tsx, lens.tsx, Logo.tsx
src/lib/         format.ts, cn.ts, useAsync.ts, status.ts
src/state/       app.tsx — session, theme, PWA install prompt
server/
  ulip-proxy.mjs  credentials, OSINT feeds, shared case store (372 lines)
  store/          index.mjs picks by DATABASE_URL; sqlite.mjs (default), postgres.mjs
api/
  _store.ts       pooled Postgres accessor for serverless; imports the driver
                  directly so node:sqlite is never pulled into a function
  cases/index.ts       GET  /api/cases
  cases/[signalId].ts  PUT  /api/cases/:id — pinned to the version you read
scripts/
  conformance.ts  mappers vs the documented response samples

Four TypeScript projects, because three runtimes disagree:
  tsconfig.app.json      src/      — Vite, bundler resolution
  tsconfig.api.json      api/      — nodenext, to match what Vercel does anyway
  tsconfig.scripts.json  scripts/  — bundler, because these import src/
  tsconfig.node.json     vite.config.ts
`api/` and `scripts/` used to sit outside every project, so the deploy's typecheck never
looked at them. Switching that on found five errors in code written minutes earlier.
docs/
  DATA-PROVENANCE.md   what is live and what is generated
  ulip-api/INDEX.md    endpoint family → the one document that answers about it
  ulip-api/pdf|txt/    DO NOT READ — 24 MB / 1.3 MB of source documents
```

### The modules, by what they do

| Module | Route | Function |
|---|---|---|
| Control tower | `/` | The hero. Role-specific headline, decisions queue, live map with optional GatiShakti overlay, risk mix, detector precision, desk load, lane performance, source health, disruption feed, port traffic. |
| Consignments | `/shipments` | The book. Filters, role-specific columns and row defaults, 360 drawer per consignment. |
| Fleet | `/fleet` | VAHAN registration, SARATHI licences, FASTag movement reconciled per vehicle. |
| EXIM | `/exim` | Import/export clearance files with demurrage clocks. |
| Compliance | `/compliance` | e-Way Bills, customs filings, statutory vehicle papers verified against source systems. |
| Lane planner | `/plan` | Plan a lane before booking: safety, restrictions, **live GRAP eligibility**, corridor weather, cost, modal trade-off. |
| Waterways | `/waterways` | National Waterways, stretches, bridge clearances, terminals. |
| Scenario drill | `/drill` | Cost a hypothetical disruption against the network as it stands. |
| Counterparties | `/parties` | Due diligence: company standing, directors, MSME status, IEC. |
| Import book | `/import` | CSV → consignment book, validated against the gateway's own regexes. |
| API gateway | `/apis` | The 95-endpoint catalogue, subscription state, live invocation with the real envelope. |
| Settings | `/settings` | Organisation, role lens disclosure, gateway connection, preferences. |

### Adding a module

data module in `src/data/` → method on `DataAdapter` → implement in `MockAdapter` →
page in `src/pages/` → lazy route in `App.tsx` → nav entry in `Shell.tsx` → **name it in
`MODULE_LABEL` and add its path to every role in `roles.ts`**. A route missing from
`roles.ts` renders fine and appears in nobody's sidebar, which looks exactly like a
broken route.

---

## 6. The role lens

Four org types: **Shipper, Transporter, Freight Forwarder, Regulator**. `roles.ts` is
the single place that decides what each sees.

**It is a lens, not access control.** It filters no records. Every route resolves by
URL and every signal stays in the queue. Real entitlement is decided by the datasets
approved against a ULIP account. The Settings page says this in those words.

| | Shipper | Transporter | Freight Forwarder | Regulator |
|---|---|---|---|---|
| Accountable for | cargo value, paperwork, arrival | vehicles and drivers being legal | other people's cargo against a clock | whether the rules held |
| Tower called | Control tower | Fleet control tower | Forwarding desk | Supervision desk |
| Leads with | Value at risk | Loads on blocked assets | Held at a border | Movements in breach |
| Not advertised | Fleet | EXIM, Waterways | Fleet | Lane planner, EXIM |
| Consignments opens on | whole book | on blocked assets | held at a border | **in breach** |
| Consignments columns | …value… | …conveyance, load… | …value… | …conveyance, e-Way Bill… (no value) |

**The Regulator never sees cargo value** — not in the headline, not in the context
chip, not as a table column. They own none of the cargo, so a rupee figure there looks
authoritative and means nothing.

**Queue ranking is band first, severity second.** A medium breach a role owns outranks
a critical one it does not. Nothing is removed, so being wrong about someone's remit
costs a scroll, not a record.

**Disclosure rule.** A lensed default must be visible and reversible. Where the filter
has a visible control (a tab, a Select), that control *is* the disclosure — set it and
stop. Where it does not, render `<LensDefault>` with a one-click way out. A silently
pre-filtered table is indistinguishable from missing data.

**Columns are a weaker lens than rows** and get no banner, because a column another
role leads with is still in the record drawer. But every field one role leads with
**must** be reachable in the drawer — check that before dropping one from a set.

---

## 7. Conventions

- **Pages never fetch.** Everything through `adapter`.
- **Charts are inline SVG** in `components/charts.tsx`. A charting library was removed
  for shipping 370 kB to draw one illegible bar chart. Do not add one back.
- **Styling** is Tailwind v4 with semantic tokens (`bg-surface`, `text-muted`,
  `border-line`) defined in `index.css`. Never hard-code a colour; both themes resolve
  through the tokens.
- **Everything must work at 375 px.** Sidebar on desktop, four tabs + a More sheet on
  mobile. Check `scrollWidth - clientWidth === 0`.
- **Name things once.** Module names in `MODULE_LABEL` (`roles.ts`), signal names in
  `SIGNAL_LABEL` (`fusion.ts`), both exhaustive `Record`s so forgetting one is a
  compile error.
- **Comments explain why, not what.** Most existing comments record a decision or a trap.
- **Tables render from a column registry** (`SHIPMENT_COLUMNS`, `FLEET_COLUMNS`), so a
  new column is one registry entry rather than an edit in four places.
- **Never fail open on a restriction.** See the GRAP trap in §8.
- **A detector's track record is a feature.** Never add a signal kind without asking how
  its precision will be measured.

---

## 8. Traps already paid for

Each of these cost real time. None would be caught by a typecheck.

**`config.ts` must stay dependency-free.** It used to live in `data/index.ts`, which
also constructs the adapter — so anything the adapter imported could not read it, and
the app died at load with *"Cannot access 'OSINT_BASE' before initialization"*.

**The ULIP envelope lies.** A missing record returns **HTTP 200** with `error: "false"`
and reports failure on the *inner* `responseStatus`. `error` and `code` are **strings**,
not a boolean and a number. Use `unwrap()` / `isNotFound()`.

**FASTag retains 72 hours only.** Anything longer is platform-stored history and must be
labelled as such. `onset()` in `fusion.ts` floors every signal's age at that horizon **on
purpose** — it is the platform's own visibility window. Unfloored, cases present as weeks
old. Do not "fix" it.

**GRAP curbs entry, not delivery** — match consignments routing *through* the NCR.

**GRAP failed open.** `ncrEligibility` matched a literal `"BS"`, but VAHAN writes
`"BHARAT STAGE II"`. No match fell through to `?? 6`, so an unreadable norm was treated
as the cleanest possible vehicle and permitted at Stage IV — a BS-II diesel truck waved
into Delhi. Unknown is now restricted.

**Bridge clearance is lowest in monsoon**, because it is measured to the water. The
season with the most depth has the least headroom.

**`dns.setDefaultResultOrder('ipv4first')`** in the proxy. GDELT publishes unreachable
AAAA records; without it you get a bare `UND_ERR_CONNECT_TIMEOUT` that looks like
downtime.

**Dates: parse documented forms as UTC first.** `Date.parse("25-Jan-2032")` succeeds as
*local* midnight, and `toISOString()` walks it back across the date line in any positive
offset — in IST a fitness expiry came out `2032-01-24`. A statutory expiry reading a day
early marks a compliant vehicle as lapsed on its last valid day.

**A generated status and a generated timetable must be reconciled.** `makeShipments` drew
both independently, producing consignments that were `planned` with a departure weeks in
the past, and ETAs behind the clock on most of the book — so anything comparing a date
against `eta` was comparing against nothing.

**Road lanes and rail tracks are different scales.** Never compare across modes. A
two-track freight corridor is not "worse" than a four-lane highway.

**Do not assert legal certainty.** The e-Way Bill signal once claimed expiry "exposes the
consignment to detention and penalty under s.129". Courts have repeatedly held otherwise
(see §2). The operational risk is real; the legal conclusion was not ours to assert.

**Vercel compiles `api/` with its own settings, reports errors, and ships anyway.**
This deployed a function that 500'd on every request while the workflow stayed green. Three
separate ways it differs from the repo's own check, none visible to `tsc -p
tsconfig.api.json`:

- It resolves as **nodenext**, and `package.json` is `"type": "module"`, so relative
  imports need explicit `.js` extensions. `'../_store'` emitted a module the runtime could
  not find — that was the crash.
- It has **no node types**, so `process.env` is an error. Reached through `globalThis` now.
- It compiles **without `strict`**, so `ok: true | false` widens to `boolean`, the
  discriminated union stops discriminating, and neither a ternary nor an `if` narrows it.

**Run `vercel build --prod` locally after touching `api/`.** It is the only check that sees
what production will. A passing `tsc` does not mean the function runs.

**Vercel deploy gotchas.** `.vercelignore` matters — the first deploy timed out uploading
23.6 MB of vendored PDFs; excluding `docs/`, `server/` and `dist/` took it to 2.0 MB.
And deployment-specific URLs stay behind Vercel Authentication even when production is
public: `ulip-platform.vercel.app` is public, `ulip-platform-<hash>-….vercel.app` is not,
and testing the wrong one looks exactly like a broken deploy.

**Derive asset names from the deployed bundle, never local `dist/`.** Vercel builds
independently, so lazy-chunk hashes differ from a local `npm run build`.

---

## 9. Verification discipline

**Calibrate generated data. Always check the distribution after generating.** This has
caught a real bug every single time it was run:

- Three screens shipped flagging *everything* — zero clear counterparties, one navigable
  month a year, overdue permanently zero.
- `constrained()` compared rail against a road standard → **5 of 5** corridors pinched.
- A corridor that was six-lane end to end reported *every* segment as a pinch, because
  `narrowest` was used without asking whether it was sub-standard.
- `MIN_SAMPLE` at 8 still admitted noise — a detector built to be right 45% of the time
  displayed **74%** and outranked genuinely good checks. Raised to 20.
- A resolution draw folded the non-verdict into the same ladder as the verdict, eating
  part of the false-positive tail, so every precision figure came out high.

A screen that flags everyone trains people to ignore it. A screen that shows almost
nothing looks broken. Check the numbers, not the intuition.

**Current healthy distribution** (mock, 160 consignments): queue 109 cases —
critical 20 / high 41 / medium 48. Top kind is schedule slip at 31. Corridor pinch fires
4 times. Detector precision spans 47% (corridor disruption) to 93% (customs hold), with
4 of 17 honestly reporting "not enough history to judge".

---

## 10. The live integration

### ULIP is a lookup API, not a list API

**The single most important architectural fact.** Every endpoint is keyed by an
identifier you must already hold: `FASTAG/01` and `VAHAN/01` want a vehicle number,
`EWAYBILL/01` a bill number, `SARATHI/01` a licence *and* a date of birth, `FOIS/01` an
FNR. **Nothing answers "what am I shipping today."**

So `UlipAdapter` is not a drop-in replacement for the simulator. It is an **enrichment
layer**, and the consignment book must come from the customer's TMS or ERP — which is
what `/import` exists for. Anything needing that book throws `NotWiredError` carrying the
reason, because an empty table is indistinguishable from a broken one.

That is also the positioning: *we are not your TMS; we enrich the consignments you
already have with government data no single ministry can give you.*

### What works live today

Vehicle lookup across VAHAN + FASTag, and the API console. That is a real day-one demo.

### What ULIP cannot supply at any price

Declared in `FIELD_GAPS` (`src/data/ulip/map.ts`) rather than defaulted:

- **Permit validity and type** — no endpoint carries them. VAHAN/01 has registration,
  fitness, insurance and PUC only. Note the Fleet compliance check counts permit expiry
  among its five expiries; on live data that dimension is simply absent.
- **FASTag balance and issuing bank** — FASTAG/01 returns toll *reads*, not wallet state.
- **Driver identity** — SARATHI needs a licence number and DOB, neither discoverable
  from a plate.
- **Utilisation** — a commercial metric, not a register.

**VAHAN masks PII.** The documented sample returns `"R***L K***R"` for owner name and
`"ME4JF509AH70*****"` for chassis.

### Conformance

`npx tsx scripts/conformance.ts` runs the mappers against response samples copied
verbatim from the integration documents. It found three bugs before any credentials
existed (see §8). **Extend it whenever you map a new endpoint.**

### Going live

1. Register on goulip.in, sign the NDA, get datasets approved (staging first).
2. Run the proxy that holds the credentials:
   `ULIP_USERNAME=… ULIP_PASSWORD=… ULIP_ENV=staging node server/ulip-proxy.mjs`
3. Start the app with `VITE_ULIP_MODE=live`.

The browser never receives the ULIP username, password or bearer token — only the proxy
does. `selectAdapter()` in `src/data/index.ts` chooses the adapter; live mode must never
relabel the mock.

---

### Delivery

A conflict that exists only on a screen nobody has open is still invisible, which is the
problem this product sells against. `notify.ts` decides what leaves the browser; the proxy
route `POST /api/notify` forwards it to `ULIP_WEBHOOK_URL`, which **never reaches the
client** — it is a capability to post into somebody's Slack, and a URL the client holds is
a URL anyone with the client holds.

The hard part is sending **little enough**. Four guards, in order of how much they matter:

1. **Severity** — critical only, by default.
2. **Or** past SLA with no owner: that is the queue failing, not a case.
3. **Never twice.** Signals are recomputed on every read, so without this a poll loop
   would re-send the same conflict forever. The mark rides on the case activity trail, so
   it is both de-duplicated and auditable beside who assigned and who closed.
4. **Ten per message**, the rest counted. Only LISTED cases are marked — marking an
   omitted one would silence a conflict nobody ever saw.

Verified end to end against a local receiver: 15 checks on selection and payload, then two
real sends through the proxy. The second delivered a different ten, omitted fell 43 → 33,
and twenty marks landed across twenty cases with none twice. A backlog drains rather than
repeating.

Every line carries the recommended action, because an alert that says what is wrong
without saying what to do is the kind people learn to scroll past.

**Not built: a scheduler.** Sending is a deliberate action from Settings, so a conflict
raised while nobody is looking waits until somebody presses the button. A cron against the
proxy is the obvious next step and the reason this is only half a delivery path.

## 11. Market context

This is **not** an empty field. 13+ organisations already hold ULIP NDA access —
MapMyIndia, Intugine, Freight Fox, Superprocure, CargoExchange, Shyplite, Lynkit, Adani
Ports among them — and 30+ apps have been built on ULIP.

**Intugine** (Bengaluru, 2017) is the closest competitor: control tower with exception
management, FASTag validation at every toll crossing, 1–5 minute location refresh,
route-deviation alerts, e-POD, yard management, own IoT hardware. "Multimodal visibility
control tower" is occupied and is table stakes.

**The wedge is statutory conflict detection**, not visibility. Intugine tells you where
the truck is; ULIX tells you the truck is under load with a lapsed fitness certificate
and an e-Way Bill that expires before it arrives. Position on compliance risk.

**The category's documented failure mode is alert fatigue** — control towers flag
everything, operators stop believing the screen, and when someone marks a false positive
nothing feeds back into classification. `quality.ts` is the answer to that and is the
thing competitors do not have.

---

## 12. Deployment

Static SPA, hash-routed, no rewrite rules needed. `vercel.json` and `netlify.toml` are
committed. `VITE_BASE=/sub/` handles subpath hosting; the manifest and service worker use
relative URLs.

| | |
|---|---|
| Site | <https://ulip-platform.vercel.app> |
| Repo | <https://github.com/kartikdogra17/ulix> (public, `main`) |
| Host | Vercel, static build, project named `ulip-platform` |
| Licence | Apache-2.0, chosen for §6 (no trademark grant) given the name's proximity to ULIP |

**A push to `main` deploys.** `.github/workflows/deploy.yml` checks out, installs, runs
the typecheck, builds, and hands the output to Vercel over the CLI. `vercel --prod` by
hand still works and bypasses it. The one secret it needs, `VERCEL_TOKEN`, is in place;
the org and project ids are committed in the workflow because they are identifiers, not
credentials.

Two deliberate behaviours, both learned from the GitHub Pages workflow this replaced —
which failed on every push for days with a 404 nobody read. It **fails readably**: a
missing token stops the run in 11 seconds with a message naming the fix. And it
**typechecks before deploying**, so a push that would not build locally cannot reach
production.

Vercel's own Git integration is **not** available here: it is gated behind a paid team
plan and this project sits in a team scope. The CLI reports that as
`POST /v9/projects/{id}/link → 400` with the message *"Failed to connect… make sure there
aren't any typos"*, which blames the repository for what is a plan limit. Two test pushes
confirmed nothing auto-deploys through it. Do not spend time re-trying `vercel git
connect`; the workflow is the way in without changing plan.

An earlier diagnosis in these notes — *"the Vercel GitHub App is not authorised for the
team"* — was **wrong**, and cost a round of dashboard changes that could not have helped.
The 400 was real and correctly located; the reading of it was not. It was never an
authorisation problem.

On the static host, GDELT, AIS and the shared case queue degrade to labelled fallbacks —
the proxy is not there, and its `localhost:8787` calls are blocked as mixed content.
**Live air quality and weather still work**, fetched from the browser.

---

## 13. State of play

**Endpoint coverage: 58 of 95 wired.** Remaining are thin — India Post ×4, IWAI
statistics ×7 (year-on-year aggregates already represented), and near-duplicates worth
skipping (Telangana VAHAN/SARATHI, fuel-station *registration* endpoints, chassis/engine
VAHAN lookups).

**Known limitations**

- No real ULIP data has ever flowed. Access is in progress; expect up to a month.
- Case work is shared through the proxy when running, per-browser otherwise. The
  **deployed** site is always per-browser.
- No tests beyond `scripts/conformance.ts` and ad-hoc distribution checks. No test runner.
- Demo sign-in only; no real auth or multi-tenancy.
- Mobile cards are one layout for every role.

**Open threads**

1. Share the queue in production — **the function is written and the client is wired**;
   it needs a provisioned Postgres and `DATABASE_URL` set on the Vercel project. Until
   then `/api/cases` answers 503 and the app falls back to per-browser storage, which is
   the documented behaviour rather than a fault. Nothing in this path has ever run
   against a real database.
2. Role-aware mobile cards.

**Not code, and higher value than either:** get the goulip.in NDA signed, and talk to
8–10 operators to test whether the statutory-conflict wedge is a real pain. Every session
so far has defaulted to building instead; neither answer changes because a feature was
added while waiting.

---

## 14. Commands

```bash
npm run dev                             # app on :5173
npx tsc --noEmit -p tsconfig.app.json     # the app
npx tsc --noEmit -p tsconfig.api.json     # serverless functions
npx tsc --noEmit -p tsconfig.scripts.json # repo scripts
vercel build --prod                       # REQUIRED after touching api/ — see §8
npm run build
npm run lint                            # oxlint
node server/ulip-proxy.mjs              # optional; needs ULIP_USERNAME + ULIP_PASSWORD
                                        # cases persist to server/data/cases.db (SQLite)
npx tsx scripts/conformance.ts          # mappers vs documented response samples
git push origin main                    # deploys via .github/workflows/deploy.yml
vercel --prod                           # deploy by hand, bypassing the workflow
```

**Do not read:** `docs/ulip-api/pdf/` (24 MB), `docs/ulip-api/txt/` (1.3 MB),
`src/data/ulip/catalogue.ts` (918 generated lines — grep it). Everything they contain is
in the catalogue already, and `docs/ulip-api/INDEX.md` maps each endpoint family to the
one document that answers questions about it. Reach for a document only when adding a new
endpoint family.
