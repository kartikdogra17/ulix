# Handoff — state of play

Written so a new session can continue without re-deriving anything. Start with
[CLAUDE.md](CLAUDE.md) for the operational brief and [knowledge-base.md](knowledge-base.md)
for the full reference — domain terminology, how the concepts join, every module, every
trap. This file is *where things stand*.

## What this is

**ULIX** — a logistics control tower built on India's Unified Logistics Interface
Platform. Independent software, not a government service. Eleven modules, ~16k lines
across `src/`, `server/`, `api/` and `scripts/`, 46 commits. Typecheck and build clean,
and pushes to `main` deploy themselves.

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

## Deployment — live, and automatic

| | |
|---|---|
| Site | **https://ulip-platform.vercel.app** |
| Repo | **https://github.com/kartikdogra17/ulix** (public, `main`) |
| Host | Vercel, static build, project still named `ulip-platform` |
| Trigger | push to `main` → `.github/workflows/deploy.yml` |

**A push to `main` now deploys.** GitHub checks out, installs, runs the typecheck, builds,
and hands the finished output to Vercel over the CLI. `vercel --prod` by hand still works
and bypasses it. Verified end to end on two consecutive commits (16 September 2026):
workflow green, deployment count moved each time, site 200.

**Vercel's own Git integration is a dead end here — do not retry it.** It requires a paid
team plan and this project sits in a team scope. The CLI reports that as
`POST /v9/projects/{id}/link → 400` with *"Failed to connect… make sure there aren't any
typos"*, which blames the repository for what is a plan limit. Two test pushes confirmed
nothing fires through it, and an earlier diagnosis of "the GitHub App is not authorised
for the team" was wrong — it was never an authorisation problem.

Setup is one secret, `VERCEL_TOKEN`, already in place. The org and project ids are
committed in the workflow because they are identifiers, not credentials.

Two things the workflow does on purpose, both learned from the GitHub Pages workflow it
replaced (deleted for failing on every push for days with a 404 nobody read):

- **Fails readably.** A missing token stops the run in 11 seconds with a message naming
  the fix, rather than a stack trace deep in a deploy action.
- **Typechecks before deploying.** A push that would not build locally cannot reach
  production.

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

## The flagship signal rests on a field that may not exist

`EWAYBILL/01` is mapped and covered by fixtures now, and doing it surfaced something that
matters more than the mapping: in the documented response, **`validUpto` is
`" 11:59:00 PM"`** — a time, with a leading space where a date should be.

The signal this product leads with compares that validity against a movement-derived ETA.
If the gateway really returns end-of-day without the day, **that comparison cannot be made
from EWAYBILL/01 alone**, and the flagship join needs a second source or a different shape.
If instead the published sample simply lost the date in extraction, everything is fine.

The mapper refuses to guess: it reports the gap rather than inferring the date from
`ewayBillDate`, because fabricating a statutory expiry is the VAHAN day-early bug again
with penalties attached.

**This is the first thing to check the day credentials arrive.** One live call answers it.

## Open threads, in the order I would pick them up

1. **Share the queue in production.** The function now exists (`api/cases/`) and the
   production build points the client at `/api/cases` on the same origin. What is left is
   yours: provision a Postgres — Neon and Vercel Postgres both have a free tier — and set
   `DATABASE_URL` on the Vercel project. Until then the route answers 503 and the app
   falls back to per-browser storage, which is documented behaviour, not a fault.

   **Nothing in this path has run against a real database.** The handlers are covered for
   method, argument and no-database cases; the compare-and-set underneath them is the same
   driver the local proxy uses, but that driver has only ever been exercised on SQLite.
   Test the 409 conflict case first when a database exists — it is the one that matters
   and the likeliest to differ.

   Verified live as far as it can be: `GET /api/cases` returns **503** with its intended
   message rather than a crash.

   **Getting there cost a deploy that 500'd on every request while the workflow stayed
   green.** Vercel compiles `api/` with its own settings — nodenext resolution, no node
   types, no `strict` — reports the errors, and builds anyway. `tsc` passing locally means
   nothing for a function. Run `vercel build --prod` after touching `api/`; full detail in
   the knowledge base's traps section.
2. **Role-aware mobile cards.** The desktop tables are lensed, the cards are not. They
   carry identity, lane, status and progress, which all four roles want. Lowest value on
   this list.

Everything else that was on this list is done: the role lens, per-role page defaults and
column sets, the licence, the GatiShakti overlay, the `corridor_pinch` signal, the leg-date
fix, the case store, the CSV import, the live adapter, and push-to-deploy.

**Still the two highest-value things, and neither is code:** get the goulip.in NDA signed
(in progress, up to a month), and talk to eight to ten operators to find out whether the
statutory-conflict wedge is a real pain. No feature added while waiting changes either
answer.

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

## The consignment book comes from a CSV

The direct consequence of ULIP being a lookup API. The book has to come from the
customer's own system, and until there is a TMS integration the shortest honest path is the
file they already export. `/import` parses it in the browser, maps the columns, and tells
each row which endpoints can enrich it.

**Rows are validated with `UlipClient.validate`** — the same call path and the same regexes
the real gateway request uses. A preview that validates differently from the actual call is
worse than no preview: it promises a lookup will work and then fails at the counter. A bad
e-Way Bill shows the gateway's own wording, verbatim: *Data format failed OR wrong value
entered at: ewbNo. Format should follow [0-9]{12}*.

Column mapping is by alias, because nobody's export says `ref`: docket/CN/LR number,
e-Way Bill under six spellings, vehicle/truck/lorry registration, from/to, goods, weight,
invoice value. Unrecognised columns are carried through and reported, not dropped silently.
A file with no e-Way Bill and no vehicle column fails fast and says why — there is nothing
ULIP could be asked about it.

The CSV parser is hand-written and dependency-free: quoted commas, doubled quotes, embedded
newlines, CRLF, and the BOM Excel puts on the front that otherwise corrupts the first
header. Indian exports carry `₹` and lakh separators, so `"₹12,45,000"` parses to 1245000.
Twenty checks cover the parser and the mapping.

A row missing its e-Way Bill still resolves against VAHAN and FASTag on its vehicle number;
partial keys give partial enrichment rather than nothing.

## The live path — and what building it revealed

**The flag used to lie.** `src/data/index.ts` hardcoded `new MockAdapter()`, and `ULIP_MODE`
was read in exactly three places: a banner and two badges. Setting the documented
`VITE_ULIP_MODE=live` dropped the "Simulated gateway" warning and turned the sidebar badge
green **over entirely seeded data**. One env var was enough to break the invariant this
project states twice. The swap point now selects an adapter.

**ULIP is a lookup API, not a list API.** This is the finding that should shape the product.
Every endpoint is keyed by an identifier you must already hold: FASTAG/01 and VAHAN/01 want
a vehicle number, EWAYBILL/01 a bill number, SARATHI/01 a licence *and* a date of birth,
FOIS/01 an FNR. **Nothing answers "what am I shipping today."**

So `UlipAdapter` is not a drop-in replacement for the simulator — it is an enrichment layer,
and the consignment book has to come from the customer's TMS or ERP. That is a pitch
sentence as much as an architecture one: *we are not your TMS; we enrich the consignments
you already have with government data no single ministry can give you.* Everything needing
that book throws `NotWiredError` carrying the reason, because an empty table is
indistinguishable from a broken one.

What genuinely works against a live gateway on day one: **vehicle lookup across VAHAN and
FASTag, and the API console.** That is a real demo, and more than the simulator can ever prove.

### What ULIP cannot supply at any price

`FIELD_GAPS` in `map.ts` declares these rather than defaulting them: **permit validity and
permit type** (no ULIP endpoint carries them — VAHAN/01 has registration, fitness, insurance
and PUC only), **FASTag balance and issuing bank** (FASTAG/01 returns toll *reads*, not
wallet state), **driver identity** (SARATHI needs a licence number and DOB, neither
discoverable from a plate), and **utilisation** (a commercial metric, not a register).
Note the Fleet compliance check counts permit expiry among its five expiries — on live data
that dimension will simply be absent.

Also worth knowing: VAHAN **masks PII**. The documented sample returns `"R***L K***R"` for
owner name and `"ME4JF509AH70*****"` for chassis.

### Three bugs the conformance check found before any credentials existed

`npx tsx scripts/conformance.ts` runs the mappers against response samples copied verbatim
from the integration documents. It found:

1. **GRAP failed open.** `ncrEligibility` matched on a literal `"BS"`, but VAHAN writes
   `"BHARAT STAGE II"`. No match fell back to `?? 6`, so an unreadable norm was treated as
   BS-VI — the cleanest possible vehicle — and permitted at Stage IV. A BS-II diesel truck
   would have been waved into Delhi. Unknown is now restricted.
2. **`BS-II` and `PETROL` were not in the domain model at all**, though both appear in the
   documented sample. Widened.
3. **Expiry dates read a day early.** `Date.parse("25-Jan-2032")` succeeds as *local*
   midnight, and `toISOString()` walks it back across the date line in any positive offset —
   in IST the sample fitness expiry came out as `2032-01-24`. A statutory expiry that reads
   a day early marks a compliant vehicle as lapsed on its last valid day. Documented forms
   are now parsed as UTC calendar dates first.

None of these could surface against the mock, which emits `"BS-IV"` and ISO dates. That is
the argument for doing this work before the credentials arrive rather than after.

## Delivery — a conflict can now leave the browser

The product computed what needs doing, who owns it and how long until the window shuts,
and none of it ever left the page. A conflict that exists only on a screen nobody has open
is still invisible, which is the problem this thing sells against.

`notify.ts` decides what goes. The proxy forwards it to `ULIP_WEBHOOK_URL`, which **never
reaches the client** — it is a capability to post into somebody's Slack, and a URL the
client holds is a URL anyone with the client holds. Slack and Teams both render the `text`
key as-is, so any endpoint taking a JSON POST works.

**The hard part is sending little enough.** A webhook firing on all 109 live cases would
reproduce alert fatigue faster than any screen. Four guards: critical only by default; or
past SLA with no owner, which is the queue failing rather than a case; **never the same
case twice**; and ten per message with the rest counted. Every line carries the recommended
action.

The third guard matters most and is easiest to miss. Signals are recomputed on every read,
so without it a poll would re-send the same conflict forever. The mark rides on the case
activity trail, which de-duplicates and makes it auditable in one move — who was told sits
beside who assigned and who closed. Only cases actually **listed** get marked; marking an
omitted one would silence a conflict nobody saw.

### The scheduler

`scripts/deliver.ts`, run by cron (`scripts/deliver.cron.example`). `npm run deliver:dry`
decides and prints without sending or marking. Fifteen minutes is the suggested cadence:
the tightest SLA here is four hours, so faster is noise, and the job is idempotent, so a
missed or overlapping run costs latency and nothing else.

It does **not** import `MockAdapter`. It builds the same deterministic world from the same
seed and talks to the proxy over the same HTTP contract the client uses, so its marks are
the client's marks. Writes are pinned to the version read — a human touching a case between
read and write means skip, not clobber.

**A scheduler must see exactly what the screen sees.** The first cut passed no fusion
context and found **90 signals where the browser found 109**, silently skipping whole kinds
including GRAP entry bans that can be critical. That is worse than having no scheduler,
because you stop watching the screen while it quietly ignores a class of signal. With
corridors, the node table, a live NCR air reading and the disruption feed it lands on 109
exactly. **Any new signal needing context needs it here too.**

### Two traps this cost

**A 200 is not proof of delivery.** The site is a static SPA with a catch-all, so POSTing
to `/api/notify` in production returns 200 and the HTML shell. The first cut read that as
success and marked every listed case notified — nothing sent, and because the mark is what
prevents re-sending, those conflicts would never have been delivered again. Both calls now
require a body of the documented shape.

**`config.ts` read `import.meta.env` unguarded**, which threw under Node and made the whole
data layer unimportable outside a browser — so no scheduler, and no real tests either. It
defaults to an empty object now; Vite still substitutes the value, verified in the bundle.

Verified end to end against a real receiver: 15 checks on selection and payload, two sends
from the running app, then two headless runs. Each sent a different ten, qualifying fell
53 → 43, and twenty marks landed across twenty cases with none twice.

## Detector precision — closing the loop

Researched the category before building this. The documented way control towers die is
alert fatigue: they flag everything, operators stop believing the screen, and — the part
that matters — when an operator marks something a false positive, **nothing feeds back into
the classification logic**. This codebase already had the `Resolution` taxonomy that
captures the verdict (`false_positive` says the government record was wrong, not the cargo)
and was doing nothing with it.

`quality.ts` computes precision per signal kind from closed outcomes:
`actioned / (actioned + false_positive)`. `no_longer_relevant` is excluded — a consignment
delivered before anyone opened the case tells you nothing about whether the check was right.

It shows up in two places: a panel under *What is driving risk* ranking every detector, and
a mark on the case row itself when the check that raised it has a weak record — *"wrong 42
of 79 times"*. The second one is the point. That is where it changes what an operator does.

The spread is deliberate and matches how each check actually works. Lookups against a
register score high (customs hold 93%, insurance lapsed 89%); things inferred from absence
or from news score low (no toll reads 53%, corridor disruption 47%) **and should**. The
corridor pinch sits at 70% because it is inferred geometry, not a fact about the route.

**Two bugs the distribution check caught, again.** `MIN_SAMPLE` started at 8, which still
admits noise — at n=8 the standard error is ~17 points, and a detector built to be right
45% of the time was displaying **74%** and ranking above genuinely good checks. And the
resolution draw folded the non-verdict into the same ladder as the verdict, so it ate a
slice of the false-positive tail and every figure came out high. Fixed both: threshold 20,
non-verdict drawn independently. Worst drift from intent is now 7pp, down from ~29pp, and
4 of 17 detectors honestly report "not enough history to judge".

## Case store — a real table, and a path off the disk

Case work was a JSON file beside the proxy. Two failure modes drove it off: a write
interrupted mid-flush leaves a truncated file that parses as nothing, and every change
rewrote the whole document. Both are transaction-shaped.

`server/store/` is one interface with two drivers, chosen by environment:

| | | |
|---|---|---|
| **SQLite** | default | `node:sqlite`, built into Node — **no dependency added** |
| **Postgres** | `DATABASE_URL` set | `pg`, imported dynamically, **never exercised** |

The contract both honour: `put(signalId, record, ifVersion)` compares and writes inside a
single transaction, and a stale pin comes back with the record as it now stands instead of
overwriting. That is the only reason a queue can be shared at all, so a third driver that
loses it is not a case store.

**Verified end to end on SQLite**, over HTTP and then through the UI: a correct pin took a
record v3 → v4; a stale pin was refused 409 with the current record and the newer status
intact; a first write pinned at 0 created v1; a restart kept all three and did **not**
re-import the old JSON over them; and clicking *Assign* in the queue landed in the table as
`in_progress / u-fatima` with its two activity entries. The old `cases.json` is imported
once, only when the table is empty, so an upgrade cannot lose a live queue and a stale file
cannot claw back a newer record.

**The Postgres driver has never run.** There is no provisioned database behind it. It is
written to be obvious rather than clever — the same `SELECT … FOR UPDATE` shape as the
SQLite one, so the two can be checked against each other by reading them side by side — but
the first person to point `DATABASE_URL` at a real instance is also the first person to test
it. `pg` is deliberately **not** a dependency: a default `npm install` stays at zero server
dependencies, and the driver tells you to `npm install pg` if you choose that path.

This still does not make the **deployed** site share a queue. Vercel serves a static SPA
with no proxy, so production remains per-browser. Closing that needs a serverless function
in front of the Postgres driver plus a database you provision — the driver is the half that
can be written without an account.

## Columns, by the role that reads them

Both tables now render from a column registry that the lens picks a list from, so adding
a column is one registry entry rather than an edit in four places.

| | Consignments | Fleet |
|---|---|---|
| Shipper | consignment · lane · modes · status · **value** · eta · progress | vehicle · state · compliance |
| Transporter | consignment · lane · **conveyance** · status · **load** · eta · progress | all six |
| Freight Forwarder | same as Shipper | vehicle · state · compliance |
| Regulator | consignment · lane · **conveyance** · **e-Way Bill** · status · eta · progress | vehicle · driver · compliance · fastag · state |

Two of these follow decisions already made higher up. The **Regulator has no Value column**
for the same reason their tower headline counts movements rather than rupees: the cargo is
not theirs. And they lose **Utilisation** on Fleet, which is a commercial metric, not a
compliance one. The Transporter trades Value for the **plate and the load** — the truck is
theirs, the invoice is not.

Forwarder and Shipper share a set, deliberately. Not every role needs a different table and
inventing a difference to fill the matrix would be worse than admitting there isn't one.

**The honesty rule is weaker here than for rows, and that is on purpose.** A hidden row
looks like missing data, so it gets a banner; a column another role leads with is still in
the record, because opening a row shows every field regardless of who is signed in. Settings
lists all four sets and says so.

Writing that claim exposed a real gap: **the e-Way Bill number was not in the consignment
drawer at all**, so it was the one column a role could lose and never find again. It is now
in the drawer — where it should always have been, being the reference anyone ringing about
a road consignment will quote.

Not done: the **mobile cards are one compact layout for every role**. They show identity,
lane, status and progress, which all four roles want, and cramming a role-specific field
into a 375px card would cost more than it returns. If that changes, the registry is the
place to hang it off.

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
