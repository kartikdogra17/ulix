# ULIX — Logistics Control Tower

Ninety-five endpoints across thirty-five government systems and seventeen ministries,
resolved into a single picture
and turned into decisions someone can act on.

One responsive web application that also installs as a mobile app: multimodal visibility,
fleet intelligence, compliance, EXIM clearance, inland waterways, lane planning, scenario
drills, counterparty due diligence and a full API gateway console.

> ULIX is **independent software built on** India's Unified Logistics Interface Platform.
> It is not a government service and is not affiliated with NICDC or DPIIT. The login and
> settings screens say so, because the name sits close to the platform it consumes.

Built against the **official ULIP integration documents** published on
[goulip.in](https://goulip.in) — all 36 of them are vendored in
[`docs/ulip-api/`](docs/ulip-api) as source PDFs plus extracted text.

---

> **New here?** [HANDOFF.md](HANDOFF.md) is where things stand and what is worth doing
> next. [DEPLOYMENT.md](DEPLOYMENT.md) covers pushing and hosting.
>
> Working on this repo with an agent? Start from **[CLAUDE.md](CLAUDE.md)** — architecture
> map, conventions, and the traps that have already cost time. It is written to save a
> session from exploring, and it names the files that should *not* be read.

## What is real, and what is simulated

> **Full breakdown: [docs/DATA-PROVENANCE.md](docs/DATA-PROVENANCE.md)** — every figure on
> every screen, where it comes from, and what it would take to make it live.

Short version: the **ULIP specification is real** (95 endpoint codes, payloads, envelope,
all extracted from the official documents), the **ULIP data is simulated**, and the
**open-source environmental feeds are genuinely live**. Anything live carries a `live`
badge; nothing simulated is ever styled to look live.

| Real, taken from the official documents | Simulated locally |
|---|---|
| All **95 endpoint codes** (`FASTAG/01`, `VAHAN/03`, `ICEGATE/11` …) | The consignments, vehicles and documents themselves |
| Base URLs, `/user/login` auth flow, bearer token, 30-minute idle expiry | Gateway latency and quota usage |
| Request parameter names, validation regexes, and the examples quoted in each document | — |
| The response envelope, inner `responseStatus`, and every documented status code | — |
| Operational constraints such as FASTag's 72-hour retention window | — |

**No live government data is fetched.** Production access requires a registered
goulip.in account, a signed NDA, an approved use case and per-dataset subscriptions.
Until then the app runs on `MockAdapter`, which imitates the documented contract
exactly — so going live is a configuration change, not a rewrite.

---

## The ULIP contract, as documented

```
Auth      POST https://www.ulip.dpiit.gov.in/ulip/v1.0.0/user/login
          {"username": "…", "password": "…"}  →  { token }

Dataset   POST https://www.ulip.dpiit.gov.in/ulip/v1.0.0/{SYSTEM}/{NN}
          Authorization: Bearer <token>
          {"vehiclenumber": "MH12AB1234"}

Staging   https://www.ulipstaging.dpiit.gov.in/ulip/v1.0.0
```

Every dataset endpoint returns the same envelope:

```jsonc
{
  "response": [ { "response": { … }, "responseStatus": "SUCCESS" } ],
  "error": "false",   // a STRING, not a boolean
  "code": "200",      // a STRING, not a number
  "message": "Success"
}
```

Two traps this shape sets, both handled in [`envelope.ts`](src/data/ulip/envelope.ts):

1. `error` and `code` are strings.
2. **A record that does not exist still returns HTTP 200** with `error: "false"`.
   The failure is reported on the *inner* `responseStatus`. Code that checks only the
   outer status silently treats "not found" as success. `unwrap()` and `isNotFound()`
   handle both layers; the API console surfaces it as a distinct badge.

---

## The point: cross-system fusion

Calling `FASTAG/01` and `VAHAN/01` separately is not a platform — it is two API calls.
The value is in the **joins**, and those are what the product leads with.

[`src/data/fusion.ts`](src/data/fusion.ts) derives signals that no single ministry
API can produce, and **every signal carries the endpoint codes that produced it**, so
an operator can always see why the platform is telling them something and which
government system to challenge if it looks wrong:

| Signal | The join |
|---|---|
| **e-Way Bill expires before arrival** | `EWAYBILL/01` validity × `FASTAG/01`-derived ETA — the consignment will be moving on a lapsed bill, exposed under s.129 |
| **Declared vehicle ≠ moving vehicle** | e-Way Bill Part-B × the registration actually generating toll reads × `VAHAN/01` — an un-updated Part-B, or an undeclared vehicle |
| **Carrying vehicle is not road legal** | `VAHAN/01` fitness/insurance × the consignment under load — an enforcement stop detains the cargo, not just the truck |
| **No toll read for N hours** | `FASTAG/01` silence on an active leg, bounded by the 72-hour retention window |
| **Licence expired under load** | `SARATHI/01` × the active road leg |
| **Hazmat without clearance** | cargo classification × `PESO/01` |
| **Customs hold** | `ICEGATE/02` × `PCS/01` demurrage exposure |

Two derived measures sit on top:

- **Risk score** — severity-weighted, per consignment.
- **Data confidence** — the share of *relevant* source systems actually reporting.
  Relevance matters: a road-only truckload has no rail leg, so FOIS silence is not a
  gap. A decision made on three systems out of four is a different decision from one
  made on one of four, and the platform says which it is rather than implying
  completeness it does not have.

### From signal to closed case

A signal is *derived* — it exists because the source data says so, and vanishes when
the facts change. A **case** is the human record attached to it, and it persists:

- **Assign** to a desk. Routing is by signal kind, so compliance issues land on
  Compliance and tag problems on the Fleet Desk rather than in one undifferentiated pile.
- **Snooze** (4/8/24h) when the answer is "not yet"; it returns to the queue on time.
- **Close** with an outcome, not just a tick — *fixed at source, mitigated, false
  positive, risk accepted, no longer relevant*. Accepting a risk **requires** a written
  reason, because that note is the audit record.
- Every action appends to an **activity trail** with actor and timestamp.

Queue views: **Queue / Mine / Unassigned / Overdue / Closed**, plus a desk-load panel
showing who is carrying what.

SLA clocks run from **when the condition arose**, not when someone first opened the
page — and detection is clamped to the platform's own visibility horizon (72h, FASTag's
retention), so it never claims to have seen something before it had data.

Resolving a case visibly moves **value at risk**: exposure counts each consignment once,
and only while its case is still live.

Case state lives in the **shared store on the proxy** when it is running, so two
controllers see the same queue; without the proxy it falls back to per-browser storage and
the UI says which, with a `shared queue` or `this browser only` badge.

Writes are optimistic. Each record carries a version, a write pins the version it was read
at, and a stale pin is rejected with 409 plus the current record — the loser of a race
reapplies its change on top rather than overwriting a colleague. Verified: a concurrent
note from another operator survives a snooze written against a stale copy, and both land
in the trail in order.

The **control tower leads with a ranked decisions queue** — what needs action, the
consignment value exposed, hours left to act, the contributing endpoints, and the
recommended next step — instead of a wall of charts. Opening any consignment gives the
same picture at entity level, including a per-system coverage table.

## Modules

| Route | What it does |
|---|---|
| `/` **Control tower** | Value at risk, unassigned and overdue counts, the working decisions queue (assign / snooze / close with an outcome), desk load, risk-coloured live map, what is driving risk, lane reliability, source-system health |
| `/drill` **Scenario drill** | Cost a disruption before it happens — GRAP stage, port shutdown, corridor closure or fog — against the network as it stands. Reports consignments caught, value exposed, **new** e-Way Bill breaches the delay would create, vehicles needing a swap and whether the fleet can cover them |
| `/waterways` **Inland waterways** | National Waterways, stretches and terminals; whether a given barge can pass in a given month, and how much it may carry; and the modal-shift case against road |
| `/exim` **EXIM cockpit** | Import and export clearance chains, each milestone attributed to the endpoint that reports it, plus the demurrage and detention clocks and which boxes are about to cross into a higher tariff slab |
| `/parties` **Counterparties** | Who you are actually trading with: company standing, directors and shared directorships, MSME status with the 45-day payment clock, and IEC validity |
| `/plan` **Lane planner** | Plan a corridor before booking it: black spots you will cross, municipal no-entry windows against your projected arrival, toll and own-account cost, energy stops, and the road/rail/sea/air trade-off on time, cost and carbon |
| `/shipments` **Consignments** | Filterable register; drawer opens on risk score and data confidence, then cross-system signals with recommended actions, a per-system coverage table, leg-by-leg journey, event chain attributed to its source system, and documents |
| `/fleet` **Fleet** | VAHAN registration and statutory validity, SARATHI licence checks, FASTag crossings and balance, utilisation and detention analytics |
| `/compliance` **Documents** | e-Way Bills, GST invoices, customs filings and vehicle papers, triaged by mismatch / expired / expiring / pending, with the specific discrepancy named |
| `/import` **Import book** | ULIP is a lookup platform — nothing in it answers *what am I shipping today*. Bring the book from the system that does: a CSV from your TMS, parsed in the browser, columns mapped by alias, each row checked against the same regexes the gateway enforces and matched to the endpoints that can enrich it |
| `/apis` **API gateway console** | The full 95-endpoint catalogue with ministry, category, parameters and regex formats; subscription state; a try-it runner returning the real envelope; request log |

### Every screen adapts to the role

Four organisation types — Shipper, Transporter, Freight Forwarder, Regulator — and the
same network reads differently to each. The tower leads with the number that role is
accountable for, the queue re-ranks by remit, and the tables carry the columns that role
reads. A regulator is never shown cargo value: they own none of it.

It is a **lens, not access control**. Nothing is filtered, every route still resolves, and
Settings says so in those words.

### The signals report their own track record

Every case closes with an outcome, and two of those are verdicts on the *detector* rather
than the consignment. Precision per check is computed from them and shown on the case
itself — *wrong 42 of 79 times*. Checks against a government register score high; anything
inferred from absence or from open news scores lower, and should. Below twenty judged
outcomes no figure is shown at all.


### One product detail worth calling out

`FASTAG/01` retains only the **last 72 hours** of transactions (§1.3.1). A fleet screen
showing 30 days of toll history from a live call would be impossible. The app therefore
distinguishes the two honestly: crossings inside the window are labelled **Live**, and
older ones **Stored** — data this platform polled and persisted itself. The banner on
the FASTag tab says exactly that.

---

## Two constraints road planning has no equivalent of

All fifteen IWAI endpoints were dark. Nine are traffic statistics; the four that matter
are `IWAI/10` waterways and stretches, `IWAI/11` navigability windows, `IWAI/12`
structures with vertical clearance, `IWAI/13` terminals positioned by chainage.

**Air draft.** A vessel must pass under every bridge on the stretch, so the binding number
is the *lowest* clearance on the route. And clearance is measured to the water — which
means it is lowest in monsoon, when the water is high. **The season that gives you the
most depth gives you the least headroom.** Software that treats clearance as a fixed
number gets this exactly backwards. The page states the reason out loud:

> Haldia – Farakka in Sep — **blocked**. Rail-cum-road bridge at chainage 203 km leaves
> **−3.9 m** over the vessel — under the 1.0 m working margin. *High water this month is
> the reason.*

**LAD — least available depth.** It sets how deep the vessel may sit, which sets how much
cargo it may carry. The same barge on the same stretch carries materially less in the
lean season.

Together: a waterway is never simply "available". It is available for a particular vessel,
carrying a particular tonnage, in a particular month. The season band shows all twelve at
once, and the modal-shift panel puts the answer against road — on NW-1's Haldia–Farakka
stretch, 1,200 t over 405 km avoids ~35 t of CO₂e and saves ₹8.92L, for 50 hours more
transit.

The nine statistics endpoints answer the other half of the decision. Feasibility says
whether a barge *can* run the stretch; `IWAI/03`, `/04`, `/05` and `/08` say whether
anyone *does*. A technically navigable stretch nobody uses has no vessel availability, no
backhaul and thin handling — you would be funding the ecosystem yourself. So each stretch
carries a liquidity band (thin / developing / established), monthly tonnage this year
against last, and terminal-level breakdowns.

Monthly traffic is drawn with the navigable window behind it, so the two can be compared
directly. A separate **traffic-vs-depth** score measures how closely reported tonnage
tracks the depth curve — deliberately vessel-independent, because reported tonnage is the
sum of every operator's movements. Scoring it against one selected barge collapsed the
number whenever a large vessel was picked, which said nothing about whether the data and
the model agreed. It now reads 46–85% across stretches, lowest on thin low-volume runs
where the series is noisiest.

Calibration note: the first cut left even the smallest barge with one clear month a year,
because the simulated LAD sat below what NW-1 actually maintains. A screen where
everything is blocked says nothing, so the depths were corrected — it now grades properly
by vessel, from twelve clear months for a small barge on NW-3 down to none for a 3-tier
container barge.

## Where the money actually burns

Eleven ICEGATE endpoints and four more from PCS sat unused while "in customs" was a
single status chip. That chip hides the part of the journey that costs the most: a box
sitting in a terminal is not late, it is **expensive**, and it gets more expensive in
steps rather than smoothly.

[`/exim`](src/pages/Exim.tsx) models two things properly.

**The milestone chain**, each step attributed to the endpoint that reports it — for a sea
export: `ICEGATE/03` shipping bill → `PCS/02` goods received → `ICEGATE/05` LEO →
`ICEGATE/13` e-seal → `PCS/03` loaded → `ICEGATE/08` EGM → `PCS/06` sailed. Imports run
the other chain, through IGM, bill of entry, assessment, duty and out-of-charge.

**The demurrage and detention clocks, which are slabbed rather than linear.** Free days,
then a daily rate, then roughly double, then double again. A flat "₹/day" figure hides
the cliff entirely, so the cockpit leads with what is about to cross one:

> **EX4206 · Paradip · demurrage — in 4h, ₹1,800 → ₹3,600/day**

Demurrage is the terminal charging for its ground; detention is the line charging for its
box. They run on different clocks and can both be live at once, so they are tracked
separately.

## Knowing who you are dealing with

Every other screen treats the consignor, consignee and carrier as names on a consignment.
[`/parties`](src/pages/Counterparties.tsx) asks what four APIs can say about them —
`MCA/03` and `MCA/05` for company standing and directors, `UDYAM/01` for MSME
registration, `DGFT/01` for the import-export code.

Two checks earn their keep on their own.

**A company struck off the register** is not an entity you can enforce a contract
against, and nothing in a consignment feed will ever tell you.

**An MSME-registered counterparty puts you on a statutory clock.** Under s.15 of the
MSMED Act 2006 a buyer must settle a registered micro or small enterprise within 45 days,
with compound interest at three times the RBI bank rate beyond that — and under s.43B(h)
of the Income Tax Act the deduction can be disallowed if it is unpaid at year end. That
is a payables obligation most TMS software never surfaces, because it lives in a
different government system from the freight. Note it raises an **obligation on you**,
not a risk from them, so it does not move the risk score.

The other checks: director standing, **shared directorships across counterparties** (a
related-party exposure larger than it looks per counterparty), IEC validity where the
party actually moves sea or air freight, and GSTIN state against the registered office.

Two calibration bugs were worth fixing during the build. The related-party check fired on
every counterparty because the simulated director pool was too small, and the IEC check
failed most EXIM traders because IEC presence was random rather than following actual
EXIM activity. The result was *zero* clear counterparties — a screen that flags everyone
trains people to ignore it. It now reads 19 clear, 10 watch, 3 blocked out of 32.

## Asking the other question

The rest of the platform is reactive — something has gone wrong and the queue says so.
[`/drill`](src/pages/ScenarioDrill.tsx) asks the opposite: *if this happens tomorrow, what
does it cost us?* Four event types, run against live network state, changing nothing.

The part worth having is the **second-order effect**. Adding delay to a consignment is
arithmetic. Noticing that the delay pushes arrival past its **e-Way Bill validity** —
turning an operational problem into a compliance one, on a consignment nobody had flagged
— is what an ops team does not get from a spreadsheet. The drill counts only breaches the
scenario *creates*, and reports separately those already lapsing regardless, because
blaming the scenario for pre-existing exposure would overstate it.

It also answers the follow-up immediately: 11 vehicles need swapping, 28 compliant units
are free, so the fleet covers it — or it doesn't, and you know how many to hire in.

One modelling note: GRAP curbs **entry**, not delivery, so the drill matches any
consignment routing *through* the NCR, not only those terminating there. That distinction
took the Stage IV result from 2 consignments to 11.

## Planning, not just tracking

Tracking answers "where is it". The five planning-side API families answer "should we
move it this way at all" — and none of the tracking screens touch them:

| Dataset | What the planner does with it |
|---|---|
| `NOENTRY/01` | Checks the projected arrival against municipal goods-vehicle windows |
| `BLACKSPOT/01` | Lists accident-prone locations on the corridor, by state and road |
| `TOLL/01` | Prices every plaza on the lane for the selected vehicle class |
| `CARBON/01–04` | Emissions per mode — rail, road, air, sea — for the actual payload |
| `EVYATRA/01`, `MOPNG/01` | Fuel and charging spaced for a loaded run |

The no-entry check is the one worth the build. A truck arriving 20:02 into a city closed
09:00–21:00 is not late — it is **stopped at the boundary**. No tracking feed shows that;
it only falls out of joining an ETA to a restriction table. The planner also says which
fix is cheaper: holding 58 minutes beats re-timing dispatch by eleven hours, and it
recommends accordingly rather than always suggesting an earlier departure.

Cost is modelled honestly: an **own-account stack** (fuel, driver, toll, upkeep) compared
against the **market freight rate**, rather than listing a ₹/tonne-km rate beside fuel —
which would count the diesel twice.

## Open-source intelligence

ULIP tells you what the government's own systems know about your consignment. It does
not tell you that Delhi is about to bar your truck, or that the corridor you are
dispatching onto is fogged in. That information is public — it just lives outside the
gateway. [`src/data/osint.ts`](src/data/osint.ts) brings it in.

**This layer is the only live data in the build.** Everything sourced from ULIP itself is
simulated; the UI marks live panels with a `live` badge so the two are never confused.
Of the three feeds here, air quality and weather fetch successfully today; GDELT and AIS
are wired but unavailable from this machine — see
[docs/DATA-PROVENANCE.md](docs/DATA-PROVENANCE.md) for exactly why.

### GRAP entry eligibility — the join worth having

Under CAQM's Graded Response Action Plan, **Stage III** bars BS-IV and older diesel goods
vehicles inside Delhi, and **Stage IV** bans their entry outright except for essential
commodities. Which stage is in force depends on air quality; whether *your* truck is
caught depends on its emission norm.

- Air quality comes from [Open-Meteo](https://open-meteo.com) (free, no key, CORS-open);
  PM2.5/PM10 are converted to a **CPCB-scale AQI** locally using the official breakpoints.
- The emission norm comes from `VAHAN/01` (`rcNormsDesc`).

Neither source can answer "can this truck enter Delhi today". Together they can — and the
verdict becomes a `grap_entry_ban` signal in the decisions queue like any other.

Because Stage III/IV is a winter phenomenon, the planner also shows the verdict at **every
stage**, so the fleet question — which units can still serve Delhi when the curbs land —
is answerable in September.

### Corridor conditions

Live temperature, precipitation, wind and visibility sampled at three points along the
lane. Sub-200 m visibility is what actually closes northern highways overnight.

### Corridor disruption feed (GDELT)

Open news, filtered hard. Raw news is a terrible operational feed — "strike" matches a
cricket report, a market piece and a port pay dispute, and the same dispute arrives forty
times from forty outlets. [`src/data/disruptions.ts`](src/data/disruptions.ts) runs five
stages, and the value is in the filter rather than the fetch:

1. **Relevance** — disruption vocabulary, minus an exclusion list that kills the
   sport / markets / cinema / idiom false positives
2. **Geography** — resolve to a known logistics node via a gazetteer with aliases
   (Bombay, Gurgaon, Vizag, JNPT…), or discard; an unplaceable protest is not actionable
3. **Category** — protest, strike, flood, closure, accident, port, weather
4. **Dedupe** — cluster headlines by Jaccard overlap of stemmed content words, not exact
   match, so *"Truckers strike at JNPT enters second day"* and *"JNPT truckers strike
   continues"* collapse into one story
5. **Score** — category weight × log-scaled corroboration × recency

Stage 4 is what makes it usable: forty outlets on one port strike becomes a single item
with `corroboration: 40`, which is a far stronger signal than forty rows. On the test
fixture, 13 articles reduce to 3 stories with all noise rejected.

Placeable, corroborated disruptions raise a `corridor_disruption` signal on consignments
routing through the affected node.

### AIS vessel positions

Ships broadcast AIS in the clear, but the access path is gated: aisstream.io is
WebSocket-only, needs a free key, and states that **direct browser connections are not
permitted**. So the proxy keeps one upstream subscription for the whole tenant and serves
snapshots, and positions are rolled up into a per-port **anchorage queue** — the
congestion signal that actually costs money.

Set `AISSTREAM_API_KEY` on the proxy to enable it; without a key the screens show
simulated traffic, labelled as such.

### Why both go through the proxy

Not incidental architecture. AIS forbids browser connections outright, and GDELT
rate-limits to roughly one request per five seconds **per IP** — so N browser tabs
hitting it directly is exactly the wrong shape. The proxy is the single upstream consumer
with a shared cache (10 min for GDELT, a 6-second minimum gap, stale-over-empty on 429).

It also sets `dns.setDefaultResultOrder('ipv4first')`: GDELT publishes AAAA records that
are unreachable from some networks, where curl falls back via happy eyeballs but undici
times out with a bare `UND_ERR_CONNECT_TIMEOUT`. That cost an hour to find once.

### Scope, deliberately narrow

This layer covers **places and rules** — environmental, regulatory, infrastructure. It
does not profile people: no driver social media, no counterparty dossiers, no scraping of
individuals. A control tower has no business doing that, and the useful signal is in the
public environmental and regulatory feeds anyway.

Every read is cached for 30 minutes, times out at 8 seconds, and fails soft — if the
network is gone the panels simply do not render and nothing else breaks.

### Caveats

- The CPCB AQI here is **computed from Open-Meteo's modelled PM values**, not a CPCB
  station reading. Treat it as indicative; CAQM invokes GRAP by notification, not by a
  number crossing a threshold.
- The GRAP curbs encoded are the freight-relevant subset. The full schedule is broader,
  and enforcement varies by district.

## Architecture

```
src/
  data/
    types.ts            Domain model
    adapter.ts          DataAdapter — the ONLY interface screens talk to
    index.ts            Swap point: mock ⇄ live
    ulip/
      catalogue.ts      GENERATED — 95 endpoints from the official documents
      envelope.ts       Response envelope, unwrap/isNotFound, error types
      client.ts         UlipClient — login, bearer, retry, regex validation
    routes.ts           Lane planning — safety, restrictions, cost, modal trade-off
    waterways.ts        National Waterways, air-draft and LAD feasibility
    osint.ts            Live open data: CPCB AQI, GRAP eligibility, corridor weather
    disruptions.ts      GDELT news → relevance, geo, dedupe, corroboration scoring
    vessels.ts          AIS positions and per-port anchorage congestion
    cases.ts            Case model: owner, status, outcome, audit trail
    mock/               Deterministic simulated world + gateway
  components/           Shell, NetworkMap, charts, case UI, primitives
  pages/                One file per module (lazily loaded)
  state/                Session, theme, PWA install
server/
  ulip-proxy.mjs        Credential-holding proxy
docs/ulip-api/          36 source PDFs + extracted text
```

Screens never call HTTP directly — they call `DataAdapter`. Swapping `MockAdapter` for a
live implementation changes no component code.

---

## Running it

```bash
npm install
npm run dev
```

### Going live

The ULIP gateway authenticates with a username and password that mint a bearer token.
**Neither may ever reach a browser.** `server/ulip-proxy.mjs` holds them:

```bash
ULIP_USERNAME=… ULIP_PASSWORD=… ULIP_ENV=staging node server/ulip-proxy.mjs
```

```bash
VITE_ULIP_MODE=live VITE_ULIP_PROXY=http://localhost:8787/api/ulip npm run dev
```

The proxy caches and refreshes the token, retries once on a mid-session 401/403,
and allow-lists request paths to real `SYSTEM/NN` endpoint codes.

To get credentials: register on goulip.in → sign the NDA → submit a use case →
get datasets approved → staging first, then production after an integration demo.

---

## Mobile

The same build installs as an app: web manifest, maskable icons, an offline shell
service worker (gateway calls are never cached), a bottom tab bar under `lg`, card
layouts replacing tables on small screens, and an in-app install prompt.

For app-store distribution, wrap `dist/` with Capacitor — the data layer needs no change.

---

## Regenerating the catalogue

`src/data/ulip/catalogue.ts` is generated, not hand-written. If ULIP publishes new
documents, re-download them from goulip.in (APIs → download icon, which POSTs the
document path to `/portalapi/portal/ulip/v1.0.0/api/docDownload`), re-extract the text,
and re-run the extractor. Endpoint ids, parameters, regex formats and examples all come
from those documents verbatim.

---

## Caveats

- Endpoint **descriptions** are the documents' own one-line summaries; a few generic
  ones ("This API will connect with IWAI API to get data") are as vague in the source.
- A handful of endpoints (`BPCL/02`, some `IWAI/*`, `MCA/01`) had no parseable request
  example in their document and carry empty parameter lists.
- Response **fixtures** exist for the core logistics datasets (FASTag, VAHAN, e-Way Bill,
  FOIS, LDB, ICEGATE, CARBON). Others echo their request with a note — add fixtures in
  `MockAdapter.resolve()` as you need them.
- Map node positions are true coordinates plotted on a graticule. It is a network
  schematic, deliberately not a boundary rendering.

---

## Licence

**Apache-2.0** — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

Chosen over MIT for Section 6: it grants no trademark or trade-name rights. For a project
whose name sits deliberately close to a government platform, that clause is doing real
work. `NOTICE` carries the obligations that travel with any redistribution — the
non-affiliation statement, the provenance of the generated catalogue, and the fact that
ULIP, VAHAN, SARATHI, FASTag and the rest are other people's marks.
