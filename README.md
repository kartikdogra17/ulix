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

## Modules

| Route | What it does |
|---|---|
| `/` **Control tower** | Network KPIs, live map of every moving consignment, volume and modal-split charts, exception queue, lane reliability, per-ministry source-system health |
| `/shipments` **Consignments** | Filterable register of multimodal consignments; drawer with leg-by-leg journey, event chain attributed to its source system, linked documents and parties |
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
