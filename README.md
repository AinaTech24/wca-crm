# WCA CRM — Insurance Data Management Platform

A cloud-style insurance CRM built with **React + Vite** (frontend), **Node/Express** (API) and
**PostgreSQL** (database). It mirrors the module structure of a full-featured insurance-data-management
platform: dashboard, master data, transaction data (policy purchase, claims, leads), office reports,
business MIS reports and utility/mail modules — under WCA's own branding.

## Structure

```
WCA CRM/
├── server/          Express + node-postgres API
│   ├── index.js     REST routes + JWT auth
│   ├── db.js        schema + seed data
│   └── pgdb.js       thin Postgres adapter (async prepare/get/all/run)
├── deploy/          VPS provisioning script + PM2 config (see VPS_DEPLOY.md)
└── client/          Vite + React SPA
    └── src/
        ├── nav.js         full navigation map (~90 modules)
        ├── pages/         Dashboard, ClientMaster, PolicyPurchase, Claims, Leads, ...
        └── components/    Layout + mega-menu TopNav
```

## Run

Needs a Postgres database — anything reachable works (local install, Docker, a
managed instance). Open two terminals.

**1. Backend**
```bash
cd server
npm install
cp .env.example .env   # then edit DATABASE_URL to point at your Postgres
npm start              # http://localhost:4000 — creates the schema + seed data on first boot
```

**2. Frontend**
```bash
cd client
npm install
npm run dev        # http://localhost:5173
```

The Vite dev server proxies `/api` to the backend, so just open **http://localhost:5173**.

## Login

| Username   | Password    |
|------------|-------------|
| `WCA_ADMIN`| `Admin@123` |

Enter the 4-digit security code shown on screen to complete login.

## Fully functional modules

- **Dashboard** — 5-step business process, company/type/business charts, policy & claim summaries, renewal lists
- **Client Master** — search filters, list, add / edit / delete
- **Policy Purchase (GI & LI)** — multi-tab form (policy details → premium → payment → related info → documents)
- **Claim Register**, **Lead View**, **Agency Master**

All other navigation entries are scaffolded placeholder pages so the full menu structure is browsable.

## Notes

WCA CRM is an independent implementation. Branding, logo, copy and colour palette are WCA's own;
only the functional workflow patterns are modelled on standard insurance-CRM practice.
