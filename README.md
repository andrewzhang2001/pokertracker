# pokertracker

A PLO/NLHE hand tracker: import Ignition hand histories or PokerNow logs, store
them, and study them through preflop reports, a postflop spot browser, a results
graph, and a private opponent roster.

## How this repo is organized

**Files are grouped by the surface they serve, not by what kind of file they
are.** Each thing you can navigate to owns a top-level folder under `src/`
holding its UI, its data, and the pipeline that builds that data. The folder
names match the routes, so the repo reads like the app.

There is no top-level `components/`, `lib/`, `utils/`, or `scripts/`. When you
add a file, it goes in the folder of the surface it serves — even when a
similarly-typed file already exists somewhere else.

```
src/
  App.tsx              the routing table — the only file that knows every surface
  main.tsx             Clerk provider + mount

  landing/             /                 the home screen
  import/              /import           paste/upload → review → export
  database/            /database         your saved hands, paged, in the replayer
  reports/             /reports          population preflop tendencies
                       /leakbuster       the same reports over your own hands
  postflop/            /postflop         formation + node spot browser
  graph/               /graph            results over time
  profiles/            /profiles         private PokerNow opponent roster
  solver-compare/      /solver-compare   your HU RFI frequency vs GTO

  shared/              used by two or more surfaces (see src/shared/README.md)

db/                    the database schema and its cross-cutting backfills
api/                   Vercel serverless endpoints (/api/hands, /api/notes, /api/profiles)
public/                served verbatim at / — the solver tables live here
```

### The rules that keep it that way

- **A new surface gets a new top-level folder** named after its route, and one
  line in `parseView()` / the view switch in `src/App.tsx`. Nothing else outside
  the folder should need to change.
- **A new file for an existing surface goes in that surface's folder.** Its data
  goes in `<surface>/data/`, the script that builds that data in
  `<surface>/pipeline/`.
- **Don't reach for `shared/` on first use.** One consumer means it lives in the
  feature. It earns promotion when a *second* real consumer appears.
- **Never import from one feature folder into another.** If `reports/` needs
  something from `postflop/`, that thing has two consumers: move it to `shared/`
  and have both import from there.

`src/shared/` is large here, and that is the honest shape of this app: a set of
thin views over one substantial poker-domain engine (parsing, hand state,
equity, spot extraction, report aggregation). It is a domain core, not a
grab-bag — see its README for what belongs in each part.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server, with `/api/*` bridged to the real handlers in `api/` |
| `npm run build` | `tsc -b` across app + node configs, then `vite build` |
| `npm test` | Vitest — 450 tests over the parser, reports, postflop and stakes |
| `npm run data:solver` | Rebuild `public/solver/**` from a local prelo export |
| `npm run backfill-*` | One-off database maintenance — see `db/README.md` |

## Deployment

Vercel. `api/*.ts` are Node-runtime serverless functions; `vercel.json` rewrites
everything except `/api/*` to `index.html` for client-side routing. Auth is
Clerk; the database is Neon Postgres over HTTP.

## Known issues

- `vercel.json` sets `"devCommand": "npm run dev:vite"`, but no `dev:vite`
  script exists (it is `dev`). Pre-existing; only affects `vercel dev`.
