# 🌍 Poly Planet

A tiny low-poly world where you **drive a car to places you've been** and pin your
memories. Type any destination, watch the car take the scenic route across a
chunky handmade globe, then drop a pin, add snapshots, and read live weather and a
short blurb about the place.

Built with **React**, **three.js**, and **Vite**. No API keys required.

### ▶ Try it live: **[poly-planet.vercel.app](https://poly-planet.vercel.app/)**

No sign-up, nothing to install — type a place and drive there. Your trips save to
your own browser, so nothing you add leaves your device.

![status](https://img.shields.io/badge/status-prototype-blue)
![license](https://img.shields.io/badge/license-MIT-green)
[![live](https://img.shields.io/badge/live-vercel-black)](https://poly-planet.vercel.app/)
[![CI](https://github.com/playworks93/poly-planet/actions/workflows/ci.yml/badge.svg)](https://github.com/playworks93/poly-planet/actions/workflows/ci.yml)

---

## ✨ Features

- **Low-poly toy globe** with flat two-tier terrain (raised land plateaus, cliff
  coastlines), trees, snow-capped mountains, and famous landmarks placed at their
  real coordinates.
- **Drive anywhere on Earth** — type any place; it's resolved via live geocoding
  and the car animates a great-circle route to it.
- **Day / night cycle** that advances as you travel, with a moving sun, moon, and
  stars, all riding along as you spin the planet.
- **Pin your memories** — each destination gets a pulsing map pin; tap it to fan
  out your snapshots as pop-out polaroids.
- **Live context cards** — each place shows current weather and a Wikipedia
  summary, fetched on demand.
- **Persists locally** — trips, notes, and photos are saved in your browser.
- Springy, "Little Big Planet"-style animation throughout; respects
  `prefers-reduced-motion`.

## 🚀 Quick start

```bash
npm install
npm run dev      # start the dev server (http://localhost:5173)
npm run build    # production build into dist/
npm run preview  # preview the production build locally
npm run lint     # ESLint (zero-warning policy)
```

Requires Node 18+ (CI and `.nvmrc` pin 20).

## 🧱 Architecture

```
poly-planet/
├─ index.html                # Vite entry
├─ public/
│  └─ favicon.svg            # faceted-globe icon
├─ src/
│  ├─ main.jsx               # React root
│  ├─ App.jsx                # thin wrapper
│  ├─ components/
│  │  └─ PolyPlanet.jsx      # the app: three.js scene, animation loop, UI, state
│  └─ lib/
│     ├─ atlas.js            # bundled fallback city list (used offline)
│     ├─ api.js              # geocoding + weather + Wikipedia (free, key-less)
│     └─ storage.js          # persistence (localStorage; swappable for IndexedDB)
├─ vite.config.js
├─ vercel.json               # build + SPA rewrite
└─ .github/workflows/ci.yml  # lint + build on every push and PR
```

The **externally-swappable concerns are isolated in `src/lib/`** on purpose:

- `storage.js` currently uses `localStorage`. For heavier photo use, swap it for
  IndexedDB (e.g. `idb-keyval`) — the interface is already async, so call sites
  don't change.
- `api.js` wraps the public data sources. To add server-side caching, rate-limit
  handling, or keyed providers (Google Places, flight data, etc.), point these at
  a serverless function instead of calling third parties directly from the browser.

The three.js scene, geometry builders, and React UI live together in
`PolyPlanet.jsx` because they're tightly coupled through refs and the animation
loop. If it grows, natural next extractions are `lib/geo.js` (sphere math + world
map), `lib/builders.js` (mesh builders), and a `useGlobeScene` hook.

## 🌐 Data sources

All free and key-less:

| Purpose            | Provider    | Notes |
|--------------------|-------------|-------|
| Geocoding          | Open-Meteo  | place name → coordinates |
| Current weather    | Open-Meteo  | temperature, conditions, wind, local time |
| Place summaries    | Wikipedia   | REST summary endpoint |

Every call is best-effort: if a request fails, the app falls back (bundled atlas)
or simply hides that card, so it keeps working offline.

> **Production note:** these free tiers are generous but rate-limited with no SLA.
> Before a real launch, route them through a small serverless function to add
> caching and respect rate limits — and to keep any future secret keys off the
> client. `.env.example` documents where a proxy URL would go.

## ☁️ Deploy

Live on Vercel at **[poly-planet.vercel.app](https://poly-planet.vercel.app/)**,
deployed straight from this repo. [`vercel.json`](./vercel.json) sets the build
command, output directory, and the SPA rewrite that lets any path resolve to the
app shell, so there's nothing to configure.

How it's wired:

| Trigger | Result |
|---------|--------|
| Merge to `main` | Production deploy to the URL above |
| Open a pull request | Its own preview URL, posted on the PR |

`main` is protected: changes land through a pull request, and CI must pass first
(see [Contributing](#-contributing)).

Nothing here is Vercel-specific beyond that one file — the build output in `dist/`
is plain static assets, so Cloudflare Pages, Netlify, or any static host works too
(each needs its own SPA-fallback rule).

## 🤝 Contributing

`main` is protected, so all work happens on a branch:

```bash
git switch -c short-descriptive-branch
# ...make the change
npm run lint && npm run build   # what CI checks
git push -u origin short-descriptive-branch
gh pr create --fill
```

A pull request needs the `verify` check (lint + build) to pass and to be up to
date with `main` before it can merge. Merged branches are deleted automatically.

## 🗺️ Roadmap ideas

- Move the Open-Meteo / Wikipedia calls behind a serverless function in `/api`
  for caching and rate-limit headroom
- "What's nearby" discovery (attractions/restaurants) via a Places API
- Auto-load a destination photo so new pins aren't empty
- Bucket-list mode (dream → planned → visited) and trip-route replay
- Collaborative maps (shared pins for group trips / teams) via a backend
- Distance/flight estimates between pins

## 📄 License

MIT — see [LICENSE](./LICENSE).
