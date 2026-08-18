# Deploying WCA CRM

> **This doc is superseded.** The app now runs on PostgreSQL (not SQLite)
> with a single-VPS deployment and auto-deploy on push — see
> [VPS_DEPLOY.md](VPS_DEPLOY.md). Everything below describes the old
> split Render (backend, SQLite) + Vercel (frontend) setup; kept only for
> reference in case you're still running that way.

This app is **two pieces**. They deploy to two different places:

| Piece | What it is | Where it can go |
|---|---|---|
| `client/` | React + Vite — static HTML/CSS/JS | **Vercel** (drag-drop works) |
| `server/` | Express + better-sqlite3 + SSE | **Not Vercel.** Render / Railway / Fly / any VPS |

## Why the backend can't go on Vercel

- `better-sqlite3` is a **native (C++) module**. Vercel's serverless runtime can't load it.
- Vercel functions have an **ephemeral filesystem** — `server/wca_crm.db` would be wiped on
  every cold start, so all clients, policies, RFQs and claims would vanish.
- The realtime feed is **Server-Sent Events** (a long-lived open connection). Serverless
  functions time out and kill the stream.

So: frontend on Vercel, backend on a host that runs a real always-on Node process.

---

## Step 1 — Deploy the backend first

You need its URL before building the frontend.

On **Render** (free tier works):
1. New → Web Service → connect the repo (or upload).
2. Root directory: `server`
3. Build command: `npm install`
4. Start command: `node index.js`
5. Deploy. You'll get something like `https://wca-crm-api.onrender.com`.

**Important — keep your data:** attach a **persistent disk** mounted at `/opt/render/project/src/server`
(or set the DB path to that mount). Without a persistent disk, the SQLite file resets on
each redeploy/restart, exactly like it would on Vercel.

Already deploy-ready in `server/index.js`:
- `const PORT = process.env.PORT || 4000` — respects the host's assigned port.
- `app.use(cors())` — accepts requests from your Vercel domain.

## Step 2 — Build the frontend against that URL

```bash
cd client && VITE_API_BASE=https://YOUR-BACKEND-URL/api npm run build
```

On Windows PowerShell:

```bash
cd client; $env:VITE_API_BASE="https://YOUR-BACKEND-URL/api"; npm run build
```

Note the `/api` suffix — the backend mounts every route under `/api`.

## Step 3 — Drag-drop to Vercel

Drag the **`client/dist`** folder (not the project root, not `client/`) onto
<https://vercel.com/new>.

`dist/vercel.json` is already included and holds the SPA rewrite:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

Without it, refreshing a deep link like `/page/rfq` returns 404 — the app uses
`BrowserRouter`, so every path must serve `index.html`.

---

## Just want to see the UI (no backend)?

Drag `client/dist` up as-is. The pages render, but login and every data screen will fail —
there is no API to answer them. Fine for a design preview, not a demo.

## Before going live

- **Change the demo login.** `WCA_ADMIN` / `Admin@123` is seeded in `server/db.js`.
- **Set a real JWT secret** via env var rather than the in-code default.
- **Restrict CORS** from `cors()` to your actual Vercel domain:
  `app.use(cors({ origin: 'https://your-app.vercel.app' }))`.
- The seeded demo data (Shakti Fabrication, Zenith Software, Orbit Retail, etc.) is inserted
  on first boot by `server/db.js` — strip those blocks for a clean production database.
