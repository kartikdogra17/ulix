# Data provenance — what is live, what is simulated

Last verified: **16 September 2026**

This platform mixes three very different kinds of data, and conflating them would be the
easiest way to mislead someone into trusting a number they should not. This document
states exactly where every figure on every screen comes from.

The rule the UI follows: **anything fetched from a live source carries a `live` badge.
Anything else does not.** There are no exceptions, and nothing simulated is ever styled
to look live.

---

## 1. Live — really fetched, right now

| Data | Source | Key needed | Verified |
|---|---|---|---|
| Delhi PM2.5 / PM10 | [Open-Meteo Air Quality](https://open-meteo.com/en/docs/air-quality-api) | No | ✅ 87.1 / 87.8 µg/m³ at 07:30 IST, 16 Sep 2026 |
| Corridor temperature, precipitation, wind, visibility | [Open-Meteo Forecast](https://open-meteo.com/en/docs) | No | ✅ 3 sample points per lane |

Both are free, keyless, CORS-open, fetched straight from the browser, cached 30 minutes,
8-second timeout, and **fail soft** — lose the network and the panels simply do not
render. Nothing else breaks.

### Derived from live data (computed here, not fetched)

| Figure | How |
|---|---|
| CPCB AQI | Worst-of sub-index over PM2.5 and PM10, using the official CPCB breakpoints |
| AQI category | Good / Satisfactory / Moderate / Poor / Very Poor / Severe bands |
| GRAP stage | CAQM AQI thresholds — **see the caveat below** |
| Vehicle entry eligibility | GRAP stage × the vehicle's BS norm and fuel |
| Fog risk | Visibility < 1000 m moderate, < 200 m severe |

> **Two caveats that matter.**
>
> The AQI here is computed from Open-Meteo's **modelled** PM values, not from a CPCB
> monitoring station. Treat it as indicative.
>
> More importantly, **CAQM invokes GRAP by notification, not automatically when a number
> crosses a threshold.** The stage shown is an *inference* from air quality, not a legal
> fact. For production, take the stage from the CAQM notification feed and use air
> quality only as an early warning.

---

## 2. Wired and verified, but not returning data here

Both fall back to a clearly-labelled simulated set. Neither is broken code.

| Feed | Status | What it needs |
|---|---|---|
| GDELT disruption news | ❌ HTTP 429 from this network | A non-throttled egress IP |
| AIS vessel positions | ❌ Unconfigured | A free `AISSTREAM_API_KEY` |

**GDELT.** The proxy does reach GDELT — it returned HTTP 200 on a quiet request during
development. It is now 429ing consistently, and this is **not our request shape**: a
minimal `query=india&maxrecords=1` sent directly, bypassing the proxy entirely, also
returns 429 while other hosts return 200 from the same shell. The egress IP is throttled.
Run the proxy from another network and the panel populates.

*One real bug found here and fixed:* GDELT publishes AAAA records unreachable from some
networks. `curl` falls back to IPv4 via happy eyeballs; undici does not, and fails with a
bare `UND_ERR_CONNECT_TIMEOUT` that looks like the host being down. The proxy now sets
`dns.setDefaultResultOrder('ipv4first')`.

**AIS.** aisstream.io is WebSocket-only, requires a free account, and states that direct
browser connections are not permitted. The socket therefore lives in the proxy. With a
key:

```bash
ULIP_USERNAME=… ULIP_PASSWORD=… AISSTREAM_API_KEY=… node server/ulip-proxy.mjs
```

The Port traffic panel flips from `simulated AIS` to `live · AIS` with no client change.

---

## 3. Simulated — everything sourced from ULIP itself

**No live government data is fetched anywhere in this build.** Production ULIP access
requires a registered goulip.in account, a signed NDA, an approved use case and
per-dataset subscriptions.

| Area | Simulated content |
|---|---|
| Consignments | 160 multimodal consignments, legs, event chains, ETAs, delays |
| Fleet | Vehicles generated from active road legs; VAHAN-shaped RC records, BS norms, fitness/insurance/PUC/permit validity |
| FASTag | Toll crossings, tag balances and status — honouring the documented 72-hour retention |
| SARATHI | Driver licences and validity |
| Documents | e-Way Bills, GST invoices, LRs, BoE, shipping bills, RRs, AWBs, and their mismatches |
| Customs / ports / rail | ICEGATE, PCS, FOIS and LDB responses |
| Lane planning | Black spots, no-entry windows, toll tariffs, energy stops — all in the shape of `BLACKSPOT/01`, `NOENTRY/01`, `TOLL/01`, `MOPNG/01`, `EVYATRA/01`, but generated |
| Carbon | Computed from standard emission factors, **not** from `CARBON/01–04` calls |
| API console | Request log, latencies, quotas and subscription state |

The simulated world is **deterministic** — a seeded PRNG, so the same data appears on
every load — and is generated relative to the current clock, so ages and validities stay
plausible.

---

## 4. Real, but specification rather than data

Easy to conflate with the above, and worth separating: this is taken **verbatim from the
36 official ULIP integration documents** downloaded from goulip.in and vendored in
[`docs/ulip-api/`](ulip-api/).

- All **95 endpoint codes** (`FASTAG/01`, `VAHAN/03`, `ICEGATE/11` …) across 35 systems
- Request parameter names, validation regexes and the examples quoted in each document
- Base URLs and the `POST /user/login` bearer-token flow, with its ~30-minute idle expiry
- The response envelope, including that a missing record returns **HTTP 200** with
  `error: "false"` and reports failure on the *inner* `responseStatus`
- Documented status codes, and constraints such as FASTag's 72-hour retention

`src/data/ulip/catalogue.ts` is **generated** from those documents, not hand-written.

---

## 5. Real user state

Case work — owner, status, snooze, resolution outcome and the activity trail — records
**your actual actions**. It persists in `localStorage`, per operator, and never leaves the
browser. In a real deployment this is the first table to move server-side; today two
controllers will not see each other's assignments.

---

## Reading the badges

| Badge | Meaning |
|---|---|
| `live` (green) | Fetched from a live external source this session |
| `simulated feed` / `simulated AIS` (amber) | Source wired but unavailable; showing a fallback |
| `Simulated gateway` banner | Every ULIP-sourced figure on the screen is generated |
