# Handoff — state of play

Written so a new session can continue without re-deriving anything. Start with
[CLAUDE.md](CLAUDE.md) for architecture; this file is *where things stand*.

## What this is

**ULIX** — a logistics control tower built on India's Unified Logistics Interface
Platform. Independent software, not a government service. Ten modules, ~12.8k lines,
typecheck and build clean.

## How it got here

The spec is real and was fetched, not invented. All 36 ULIP integration documents were
downloaded from goulip.in (via the portal's own `docDownload` endpoint), 726 pages, and
`src/data/ulip/catalogue.ts` is **generated** from them: 95 endpoint codes, parameters,
validation regexes and examples, verbatim. Everything else about the gateway — the
`/user/login` bearer flow, the response envelope, FASTag's 72-hour retention — comes from
those documents too.

The data the app *shows* is simulated. The distinction is documented in
[docs/DATA-PROVENANCE.md](docs/DATA-PROVENANCE.md) and enforced in the UI by a `live`
badge. **Keep that invariant.**

## Modules

`/` control tower · `/shipments` · `/fleet` · `/exim` · `/compliance` ·
`/plan` lane planner · `/waterways` · `/drill` scenario · `/parties` counterparties ·
`/apis` gateway console

The product thesis lives in `src/data/fusion.ts`: signals that only exist when two
government systems are joined — an e-Way Bill expiring before a FASTag-derived ETA, a
declared Part-B vehicle that differs from the one generating toll reads, a BS-IV truck
heading into an NCR under GRAP Stage IV. Every signal cites the endpoints that produced
it, and becomes a case someone owns.

## Endpoint coverage

**58 of 95 wired.** Remaining are thin: India Post ×4 (non-metro last mile), IWAI
statistics ×7 (year-on-year aggregates already represented), and near-duplicates worth
skipping — Telangana VAHAN/SARATHI, fuel-station *registration* endpoints, chassis/engine
VAHAN lookups.

`docs/ulip-api/INDEX.md` maps each family to the one document that answers questions
about it, so nobody greps 36 files.

## Live vs simulated, precisely

- **Live, verified:** Open-Meteo air quality and weather → CPCB AQI → GRAP stage →
  per-vehicle entry eligibility. Fetched from the browser, keyless, CORS-open.
- **Wired but unavailable here:** GDELT (429 from this egress IP — proven not to be our
  request shape, a minimal query direct from curl also 429s) and AIS (needs a free
  `AISSTREAM_API_KEY`; the service forbids browser connections, hence the proxy).
- **Everything ULIP:** simulated, deterministic, seeded.

## Deployment — live

| | |
|---|---|
| Site | **https://ulip-platform.vercel.app** |
| Repo | **https://github.com/kartikdogra17/ulix** (public, `main`) |
| Host | Vercel, static build, project still named `ulip-platform` |

Deploys are currently **manual** — `vercel --prod` from this directory. The repo is not
connected in Vercel's Git settings, so a push does not redeploy.

`vercel git connect --yes` **does** exist and was tried on 16 September 2026. It fails
with *"Failed to connect kartikdogra17/ulix to project"* even though the repo is public,
spelled right and reachable via `gh`. The CLI cannot grant itself GitHub access: the
Vercel GitHub App has to be installed and authorised for the `kartiks-projects-3e44c9bb`
team first, and that is a browser step. Do that once in the dashboard, then the CLI
command works — until then the error message is misleading, because it blames the
repository for what is an authorisation gap.

Two gotchas already paid for:

- **`.vercelignore` matters.** The first deploy timed out uploading 23.6 MB, almost all of
  it the vendored PDFs in `docs/`. Excluding `docs/`, `server/` and `dist/` took the
  upload to 2.0 MB. Do not remove it.
- **Deployment-specific URLs stay behind Vercel Authentication** even when production is
  public. `ulip-platform.vercel.app` is public; `ulip-platform-<hash>-...vercel.app` is
  not, and testing the wrong one looks exactly like a broken deploy.

On this static host, GDELT, AIS and the shared case queue fall back to their labelled
simulated state — no proxy. Live air quality and weather still work, fetched from the
browser.

Loose ends: `.github/workflows/deploy-pages.yml` is committed but dormant and now
redundant against Vercel; the Vercel project could be renamed `ulix` to match.

## Role lens — done

The four org types now change what you see. `src/data/roles.ts` is the one place that
decides it, and every screen reads from there.

| | Shipper | Transporter | Freight Forwarder | Regulator |
|---|---|---|---|---|
| Leads with | Value at risk | Loads on blocked assets | Held at a border | Movements in breach |
| Tower called | Control tower | Fleet control tower | Forwarding desk | Supervision desk |
| Not advertised | Fleet | EXIM, Waterways | Fleet | Lane planner, EXIM |

It also re-ranks the decisions queue by remit — band first, severity second, so a medium
breach a role owns outranks a critical one it does not — dots the checks that are yours in
*What is driving risk*, and swaps the chip beside the page title (a regulator is shown
movements and vehicles, never a rupee figure for cargo they have no stake in).

**It is a lens, not access control**, and the Settings page says so in those words.
Nothing is filtered: `#/plan` still resolves for a regulator. Real entitlement is decided
by the datasets approved against a ULIP account, and pretending otherwise in a browser
would be the dishonest kind of demo this project has avoided everywhere else.

Two things worth knowing if you extend it:

- A route missing from `roles.ts` appears in **nobody's** sidebar. `MODULE_LABEL` is the
  single source of module names now, and `SIGNAL_LABEL` in `fusion.ts` of signal names —
  both exhaustive `Record`s, so forgetting one is a compile error rather than a
  titleCased slug appearing in a screen nobody was looking at.
- The per-role headlines count **distinct consignments**, not signals. One truck with a
  lapsed certificate *and* no insurance is one movement to stop, not two.

### What each module opens on

`pageDefaults` on the lens seeds the filter state of four pages. Consignments gained a
`signalKinds` filter on `ShipmentQuery` to make it possible — role-agnostic at the
adapter, which only knows how to filter; the lens decides which kinds matter.

| | Consignments | Fleet | Compliance | Counterparties |
|---|---|---|---|---|
| Shipper | whole book, newest | all | Expiring | all |
| Transporter | on blocked assets | issues only | Expiring | all |
| Freight Forwarder | held at a border, soonest ETA | all | all | all |
| Regulator | in breach | issues only | Expired | Blocked |

**Checked the distribution, per the standing trap.** Of 160 consignments, the defaults
land on 160 / 13 / 20 / 26 — and each matches that role's own tower headline, so two
screens never disagree. Counterparties for a regulator is the narrowest at 3 of 32
blocked, which is deliberate: those are the ones where something has to happen, and the
tiles directly above show Clear 19 / Watch 10 / Blocked 3, so the page cannot be mistaken
for empty.

**The rule that keeps this honest:** a lensed default is visible and reversible. Where
the filter has a control — the Compliance status tabs, the Fleet and Counterparties
Selects — that control *is* the disclosure. Consignments' signal filter has no control,
so it renders `<LensDefault>` (`src/components/lens.tsx`) naming the role and the filter
with a *Show everything* button, verified to restore all 160.

Not lensed, deliberately: **EXIM** has no role-specific opening question — every role
that sees it wants both directions — and a default for it was removed rather than left as
dead config. Lane planner, Waterways, Scenario drill and API gateway are tools you arrive
at with a question already in hand, not worklists that can open on the wrong one.

## Open threads, in the order I would pick them up

1. **GatiShakti ×5** as a corridor overlay on the existing map, rather than a new screen.
3. **Case store on a real datastore** if it ever outgrows a JSON file, or if it needs to
   run serverless.
4. **Column sets per role**, if it ever seems worth it. Defaults changed which *rows* you
   land on; which *columns* matter also differs, but that is a much larger change to
   every table for a smaller return, so I stopped at rows.

## GatiShakti — the map's under-layer

Wired as a layer under the existing map rather than a screen of its own, because a
corridor only means something next to the consignments using it. All five endpoints, read
from `ULIP_GATISHAKTI_Integration_Requirement`:

| | Returns | On the map |
|---|---|---|
| `GATISHAKTI/01` | highway segments, `gis_length`, `lane_statu` | corridor lane status |
| `GATISHAKTI/02` | storage and warehousing infrastructure | **counted, not plotted** |
| `GATISHAKTI/03` | toll plazas, operator, lanes | toll glyphs |
| `GATISHAKTI/04` | industrial parks, land available | park glyphs |
| `GATISHAKTI/05` | named economic corridors, length | the polylines |

Five real alignments: Golden Quadrilateral, North–South, East–West, and the Western and
Eastern Dedicated Freight Corridors. The corridors and their routing are factual; lane
status, tolls and land figures are generated.

**GATISHAKTI/02 is counted rather than plotted on purpose.** It returns a state and a
postal address and no coordinates. Geocoding depots to get them onto the map would be
inventing a field the gateway does not return, which is the same sin as badging simulated
data `live`.

**Two bugs the distribution check caught**, and the reason to keep running it:

1. `constrained()` compared rail against a road standard, so every freight corridor was
   "below four lanes" — a corridor with no lanes at all. Road lanes and rail tracks are
   different scales and are now never compared across modes.
2. At a 1-in-6 chance of a two-lane segment, **5 of 5** corridors came back constrained.
   That rate sounds like a minority until you remember the Golden Quadrilateral has
   sixteen segments. At 5% it is 3 of 5, with two corridors genuinely clear. A separate
   bug in the same area: a corridor that is six-lane throughout reported *every* segment
   as a pinch, because `narrowest` was being used without asking whether it was actually
   sub-standard — the map drew the whole thing amber.

The overlay is off by default. Infrastructure is context; the map's first job is still to
show where the risk is.

### `corridor_pinch` — the join the overlay was for

GatiShakti knows a stretch is still two lanes; the consignment book knows what is about to
cross it. Neither record mentions the other, which is the shape of every signal in
`fusion.ts`.

Matched **per leg**, not per journey: a road corridor constrains the road leg, and a
multimodal consignment's overall origin and destination say very little about where its
trucks run. A pinch counts when its midpoint sits within 55 km of that leg's own path and
is still ahead of the consignment — for a pending leg the whole leg is ahead, for an
active one the consignment's last known position says how much is left. A constraint
behind you is history.

`fusion.ts` still holds no node table. It takes a `nodeAt` lookup on `FusionContext` and
asks where a node is rather than knowing; it is the only data module that imports no
geography and that is worth keeping.

**It fires 4 times across 160 consignments, and that is the honest number** — there are
only four constrained stretches nationally and a leg has to actually run over one. Sample:
a Haldia→Ludhiana rail leg against the Pandit Deen Dayal Upadhyaya–Dhanbad single-track
stretch of the Eastern DFC, which is exactly where that path runs. Rare and specific beats
common and vague; it still earns a row in *What is driving risk*.

Primary for Shipper, Transporter and Forwarder — all three can re-time or re-plan. Muted
for the Regulator: a two-lane highway is a planning matter, not a breach.

**A dead end worth recording so nobody repeats it.** Every pinch case aged to exactly
`3d 0h`, and the cause is `onset()` flooring every signal at the FASTag 72-hour horizon. A
corridor's lane status is a published record with no retention window, so this looked like
the same category error as comparing rail track to road lanes, and I gave the signal an
unfloored clock. That was wrong. Unfloored, these age from a planned departure that can be
weeks old and present as 21-day-old cases — precisely what the horizon comment says it
exists to prevent. The floor is a deliberate product decision about the platform's own
visibility, not a FASTag leak. Reverted to the shared `onset`, and the real cause — the leg
dates — was fixed separately, below. Ages now vary as they should.

## The timetable now agrees with the status

`makeShipments` drew `status` from one distribution and `createdAt` from another, then
built the legs forward from `createdAt`. The two were never reconciled, so a consignment
could be **`planned` with its first leg booked to depart three weeks ago**, and most
undelivered consignments carried an ETA already in the past.

The schedule is now re-anchored to the clock once progress is known: a planned consignment
departs in the future, an in-flight one has *now* somewhere inside its journey, and a
delivered one finished before now. The two date draws were kept at the same count and
ranges and reinterpreted as a **booking lead** rather than an absolute age, so a date fix
does not re-roll every commodity, weight and invoice value downstream.

Checked across all 160: **0 pending legs with a departure already past** (the bug), and 0
violations of planned-not-yet-departed, delivered-arrived-before-now, in-flight-now-inside
-the-journey, or created-before-its-own-departure. An `in_transit` example sits 71% through
a 45.1h journey having departed 32.2h ago, which is the arithmetic working.

**This was hiding real signals, not just cosmetics.** `e-Way Bill expiring mid-transit`
went from 3 to 11, because comparing a document's validity against an ETA three weeks in
the past is a comparison about nothing. `0 of 104` undelivered consignments now have an ETA
behind them, where most used to. Queue 101 → 109, criticals 12 → 20, and no kind dominates:
the top is schedule slip at 31 of 160.

## Licence

**Apache-2.0**, chosen over MIT for Section 6: it grants no trademark or trade-name
rights. For a project whose name sits deliberately close to a government platform, that
clause is doing real work rather than decorating the repo. `LICENSE` is the canonical
text fetched from apache.org, byte-identical apart from the copyright line.

`NOTICE` is where the obligations live, and Apache-2.0 requires it to travel with any
redistribution: the non-affiliation statement, the fact that the catalogue is generated
from documents published on goulip.in that belong to their publishers, the pointer to
`docs/DATA-PROVENANCE.md` for what is simulated, and that ULIP, VAHAN, SARATHI, FASTag
and the rest are other people's marks. The UI says the same things to users; NOTICE says
them to whoever takes the code.

One thing deliberately **not** settled: whether generating `catalogue.ts` from the
published integration documents is licensed by whatever terms goulip.in attaches to them.
NOTICE states the position factually and claims nothing. If this were ever to become a
commercial product rather than a demonstration, that is a question for a lawyer, not for
a licence file.

## Traps already paid for

All recorded in CLAUDE.md. The one that recurs, and the reason to check a distribution
after generating data: **three separate screens shipped flagging *everything*** — zero
clear counterparties, one navigable month a year, overdue permanently zero. A screen that
flags everyone trains people to ignore it.
