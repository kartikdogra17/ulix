# ULIP — Unified Logistics Interface Platform

A master platform for India's **Unified Logistics Interface Platform**: one responsive
web application that also installs as a mobile app, covering multimodal shipment
visibility, fleet intelligence, document compliance and a full API gateway console.

Built against the **official ULIP integration documents** published on
[goulip.in](https://goulip.in) — all 36 of them are vendored in
[`docs/ulip-api/`](docs/ulip-api) as source PDFs plus extracted text.

---

## What is real, and what is simulated

This distinction matters, so it is stated plainly everywhere in the product:

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

Case state is stored per-operator in `localStorage` and never leaves the browser. In a
real deployment this is the one table you would move server-side first.

The **control tower leads with a ranked decisions queue** — what needs action, the
consignment value exposed, hours left to act, the contributing endpoints, and the
recommended next step — instead of a wall of charts. Opening any consignment gives the
same picture at entity level, including a per-system coverage table.

## Modules

| Route | What it does |
|---|---|
| `/` **Control tower** | Value at risk, unassigned and overdue counts, the working decisions queue (assign / snooze / close with an outcome), desk load, risk-coloured live map, what is driving risk, lane reliability, source-system health |
| `/shipments` **Consignments** | Filterable register; drawer opens on risk score and data confidence, then cross-system signals with recommended actions, a per-system coverage table, leg-by-leg journey, event chain attributed to its source system, and documents |
| `/fleet` **Fleet** | VAHAN registration and statutory validity, SARATHI licence checks, FASTag crossings and balance, utilisation and detention analytics |
| `/compliance` **Documents** | e-Way Bills, GST invoices, customs filings and vehicle papers, triaged by mismatch / expired / expiring / pending, with the specific discrepancy named |
| `/apis` **API gateway console** | The full 95-endpoint catalogue with ministry, category, parameters and regex formats; subscription state; a try-it runner returning the real envelope; request log |

### One product detail worth calling out

`FASTAG/01` retains only the **last 72 hours** of transactions (§1.3.1). A fleet screen
showing 30 days of toll history from a live call would be impossible. The app therefore
distinguishes the two honestly: crossings inside the window are labelled **Live**, and
older ones **Stored** — data this platform polled and persisted itself. The banner on
the FASTag tab says exactly that.

---

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
    mock/               Deterministic simulated world + gateway
  components/           Shell, NetworkMap, UI primitives
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
