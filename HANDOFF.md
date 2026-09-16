# Handoff — state of play

Written so a new session can continue without re-deriving anything. Start with
[CLAUDE.md](CLAUDE.md) for architecture; this file is *where things stand*.

## What this is

**ULIX** — a logistics control tower built on India's Unified Logistics Interface
Platform. Independent software, not a government service. Ten modules, ~12.5k lines,
16 commits, typecheck and build clean.

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

**53 of 95 wired.** Remaining are thin: GatiShakti ×5 (infrastructure overlay),
India Post ×4 (non-metro last mile), IWAI statistics ×7 (year-on-year aggregates already
represented), and near-duplicates worth skipping — Telangana VAHAN/SARATHI, fuel-station
*registration* endpoints, chassis/engine VAHAN lookups.

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
yet connected in Vercel's Git settings, so a push does not redeploy. Connecting it is a
dashboard action the CLI cannot do.

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

## Open threads, in the order I would pick them up

1. **Role-differentiated views.** Four org types exist (Shipper, Transporter, Freight
   Forwarder, Regulator) and barely change what you see. The largest gap between what the
   app models and what it does.
2. **A licence file.** None committed, so default copyright applies on a public repo.
3. **GatiShakti ×5** as a corridor overlay on the existing map, rather than a new screen.
4. **Case store on a real datastore** if it ever outgrows a JSON file, or if it needs to
   run serverless.

## Traps already paid for

All recorded in CLAUDE.md. The one that recurs, and the reason to check a distribution
after generating data: **three separate screens shipped flagging *everything*** — zero
clear counterparties, one navigable month a year, overdue permanently zero. A screen that
flags everyone trains people to ignore it.
