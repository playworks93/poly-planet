# Poly Planet — project notes for Claude Code

A React + three.js single-page app: a low-poly toy globe you drive a car around to
pin travel memories. This file gives Claude Code the context to work here well.

## Commands

- `npm run dev` — dev server (Vite, port 5173)
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the built app
- `npm run lint` — ESLint

Always run `npm run build` after non-trivial changes to confirm the app still
compiles before considering a task done.

## Git workflow

`main` is protected — **never commit or push to it directly.** Every change goes
on a branch and lands through a pull request:

```bash
git switch -c short-descriptive-branch
# ...make the change, then commit
git push -u origin short-descriptive-branch
gh pr create --fill
```

- A GitHub ruleset rejects direct pushes to `main`, and a local `pre-push` hook
  fails fast before the network round trip. If a push to `main` is refused, that
  is working as intended — branch instead, don't reach for `--no-verify`.
- CI (`.github/workflows/ci.yml`, job `verify`) runs `npm run lint` and
  `npm run build` on every PR and must pass before merging. Run both locally
  first so you aren't waiting on CI to find a lint error.
- Branches must be up to date with `main` before merging; rebase if CI says so.
- Merged branches are deleted automatically.
- PRs need no approvals, so you can merge your own once `verify` is green. If
  collaborators join, raise the required approval count.

## Layout & where things live

- `src/components/PolyPlanet.jsx` — the whole app: three.js scene setup,
  geometry builders, the `requestAnimationFrame` loop, and all React UI/state.
  This is large and intentionally kept together because the scene and UI are
  coupled through refs (`three.current`, `driveRef`, `popoutRef`, etc.).
- `src/lib/atlas.js` — bundled fallback city list.
- `src/lib/api.js` — geocoding / weather / Wikipedia (free, key-less, best-effort).
- `src/lib/storage.js` — persistence over `localStorage`, async interface.

## Conventions & gotchas

- **Coordinates:** `latLngToVec` / `vecToLatLng` convert between lat/lng and
  unit vectors. Longitude uses `-z` for east; keep that sign convention.
- **Placing things on the globe:** use `orientOnSphere(obj, unitPos, forward,
  radius)`. Its basis is right-handed (`right = up × forward`). A left-handed
  basis silently corrupts rotations — don't "fix" the cross-product order.
- **Sitting on terrain:** call `ground(unitVec)` (raycasts the real mesh) rather
  than assuming a fixed radius, so props sit on the actual surface.
- **Terrain is two flat tiers** (ocean ≈ r1.0, land ≈ r1.035) displaced *per face*
  so coastlines form clean cliffs; a post-process removes speck islands and fills
  landlocked lakes. Don't reintroduce per-vertex displacement (it ramps coasts).
- **Everything rotates with the globe:** clouds, sun, moon, and stars are children
  of the `globe` group. Keep new world objects parented to it.
- **APIs are best-effort:** every fetch must fall back gracefully (null → hide the
  card, or use the bundled atlas). Never let a failed request break the app.
- **Storage is async and may fail** (quota/private mode). Handle the `false`
  return from `stSet`.
- Respect `prefers-reduced-motion` (checked via `reducedMotion.current`).
- No secret API keys in client code. New keyed services go through a serverless
  proxy; document the public proxy URL in `.env.example` as `VITE_...`.

## Good next tasks (see README roadmap)

- Extract `lib/geo.js` (sphere math + world map) and `lib/builders.js` (mesh
  builders) out of the component if it needs to grow.
- Add a serverless `/api` proxy for the data calls.
- "What's nearby" discovery; destination photos; bucket-list mode.
