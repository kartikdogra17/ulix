# Deploying ULIX

The app is a static SPA with hash routing, so it deploys to any static host with no
server-side rewrite rules. Configs for three hosts are committed.

## What works on a static deploy, and what does not

| | Static deploy |
|---|---|
| All ten modules, simulated ULIP data | ✅ |
| **Live air quality → GRAP eligibility** | ✅ Open-Meteo is HTTPS and CORS-open, fetched straight from the browser |
| **Live corridor weather** | ✅ same |
| GDELT disruption feed | ⚠️ falls back to its labelled simulated set — needs the proxy |
| AIS vessel positions | ⚠️ same, and needs an `AISSTREAM_API_KEY` |
| Shared case queue | ⚠️ falls back to per-browser storage, badge reads *this browser only* |

Nothing breaks. Every degraded feature fails soft and says so in the UI. To get the last
three, run the proxy somewhere with a persistent disk (Render, Fly, Railway) and point
`VITE_ULIP_PROXY` at it.

## 1. Push to a remote

There is no remote configured yet. Create an **empty** repository — no README, no
`.gitignore`, no licence, or the first push will conflict — then:

```bash
git remote add origin https://github.com/<you>/ulix.git
git push -u origin main
```

Your commits carry `kartikdogra17@gmail.com`. On a public repo that address becomes
public. To use GitHub's no-reply address for future commits:

```bash
git config user.email "<id>+<username>@users.noreply.github.com"
```

Rewriting the existing sixteen commits to change the author is possible but destructive —
`git filter-repo --mailmap` — and not worth it unless the address genuinely matters.

## 2. Deploy

### Vercel or Netlify — recommended, serves from a domain root

Import the repository in the dashboard. Both configs are already committed
(`vercel.json`, `netlify.toml`); build command `npm run build`, output `dist`. Nothing
else to set — there are no build-time secrets.

### GitHub Pages

`.github/workflows/deploy-pages.yml` is committed. Enable it once under
**Settings → Pages → Source: GitHub Actions**, then push. The workflow sets
`VITE_BASE=/<repo>/` because Pages serves from a subpath; the manifest and service worker
already use relative URLs so they follow.

### Anywhere else

```bash
npm run build          # → dist/, serve at a domain root
VITE_BASE=/sub/ npm run build   # → dist/, serve at /sub/
```

## 3. Before making the repo public

- **The disclaimers are load-bearing.** The app renders simulated data that resembles real
  government logistics output, and the name sits close to ULIP. The login screen and the
  Settings → gateway section both state that ULIX is independent software, not a
  government service, and not affiliated with NICDC or DPIIT. Do not remove them.
- **No licence file is committed.** Without one, default copyright applies and nobody may
  reuse the code. Add `LICENSE` if you want that different — it is a deliberate choice,
  not an oversight.
- **`docs/ulip-api/pdf/` is 24 MB** of PDFs republished from goulip.in. They are publicly
  downloadable there, so redistribution is unlikely to be a problem, but they make the
  clone heavy. To drop them from history later:
  ```bash
  git filter-repo --path docs/ulip-api/pdf --invert-paths
  ```
  The extracted text in `docs/ulip-api/txt/` (1.3 MB) is what anything actually greps, and
  `src/data/ulip/catalogue.ts` is generated from it — so the PDFs are provenance, not a
  dependency.

## 4. Running the proxy (optional, for the last three features)

Never deploy it with credentials baked in. Set them as environment variables:

```bash
ULIP_USERNAME=…  ULIP_PASSWORD=…  ULIP_ENV=staging \
AISSTREAM_API_KEY=…  ALLOWED_ORIGIN=https://your-deployed-app \
node server/ulip-proxy.mjs
```

Then rebuild the front end with `VITE_ULIP_PROXY=https://your-proxy/api/ulip`. The case
store writes to `server/data/cases.json`, which is gitignored and needs a mounted volume
to survive a restart.
