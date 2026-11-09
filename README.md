# Tab — split the restaurant bill, live with Stellar

Tab is a mobile-first web app for splitting a restaurant bill with friends, settled on the Stellar network. One host creates a table, adds the items and prices in native XLM, and shares a short link. Everyone opens the link on their own phone, enters their name, and taps what they ate. Shared dishes are split equally among the people who tapped them, tax and tip are shared in proportion to what each person had, every phone updates automatically every 2 seconds, and participants can pay the host directly via Stellar Testnet using Freighter wallet.

No accounts, no app install — instant bill splitting and peer-to-peer Stellar settlement.

## Features

- **Create a table** — just a name; tax (7.5%) and tip (10%) are pre-filled and changeable. You land straight in "Edit bill" to add items, with an **Invite the table** card (copy link, or the phone's share sheet where supported).
- **Host-only bill editing** — the host switches between **Tap items** and **Edit bill**: add, edit and remove items, change tax and tip, and set their Stellar public key for receiving payments. **Load sample bill** creates real sample items through the API.
- **Join without an account** — the first thing a guest sees is "What's your name?" with a one-line explanation. Names are unique per table (case-insensitive); the error explains what to do if you joined on another phone. This browser remembers you ("Welcome back, Ada"). Tapping an item before joining jumps to the name field.
- **Claim items** — big tap targets with price in XLM, a tick when it's yours, the avatars of everyone sharing it, "Shared by 3 · 3.00 XLM each", and your own share.
- **"At the table"** — everyone who has joined, with matching colours throughout.
- **Live total** — a sticky "You owe X.XX XLM" bar on phones (tap for the subtotal/tax/tip breakdown); a card on desktop.
- **Live updates** — every phone polls every 2 s; claims, people, unclaimed items and totals refresh without reloading. If the connection drops, a "Reconnecting…" badge and note appear and the last good data stays on screen.
- **Unclaimed items** — a compact red summary (count, amount incl. tax & tip, first three items with prices, "+N more"); tapping one scrolls to it. Unclaimed items are never in anyone's total.
- **Settlement & Stellar payments** — "Who owes what" lists everyone (tap for their breakdown) plus the bill totals. The host finalizes or unlocks the bill, guests can connect Freighter wallet to pay their exact share directly to the host's Stellar wallet on Testnet, and **Copy summary** puts a text summary with Stellar payment memos on the clipboard.
- **Feedback** — toasts confirm actions ("Added Jollof rice", "Bill finalized", "Payment verified on Stellar") and show server errors; a finalized banner tells everyone the amounts are final.

## How the money works

All amounts are stored and calculated as **integer stroops** (1 XLM = 10,000,000 stroops) using PostgreSQL `BIGINT` and JavaScript `BigInt`. No floating-point number is ever used for money. The calculation lives in one place, [`server/src/money.js`](server/src/money.js), and the server recalculates everything on every request; the browser only formats the numbers.

1. **Shared items** — an item's price is divided equally among the people who claimed it.
2. **Subtotal** — a person's subtotal is the sum of their shares.
3. **Tax and tip** — both are percentages of the pre-tax subtotal (tip is not charged on tax), shared in proportion to each person's subtotal. People who claimed nothing pay nothing.
4. **Unclaimed items** — stay on the bill, are flagged in red, and are excluded from everyone's total.

### Rounding policy

Amounts are rounded to the stroop ($10^{-7}$ XLM) so that **everything always adds up exactly**:

- **Splitting an item** uses the *largest-remainder* method: everyone gets the rounded-down share, and any leftover stroops go one each to the people who claimed it **first**. Example: 10.00 XLM (100,000,000 stroops) split three ways → 3.3333334 XLM, 3.3333333 XLM, 3.3333333 XLM.
- **Tax and tip** are each rounded once (half-up) on the total *claimed* subtotal, then divided between people in proportion to their subtotals with the same largest-remainder method (ties go to whoever joined first).
- **Bill-level tax and tip** are rounded once on the whole bill subtotal. The unclaimed portion is defined as *bill total − claimed total*.

So: `sum of everyone's totals + unclaimed total = total bill`, to the exact stroop. This is checked by the tests, including 300 randomised bills.

Limits: prices up to 100,000,000.00 XLM with at most 7 decimals; tax 0–50%; tip 0–100% (at most 2 decimals each); up to 100 items and 30 people per table.

## Tech stack

| Part | Choice |
|---|---|
| Frontend | React 19 + Vite 8, JavaScript, Tailwind CSS v4 (official `@tailwindcss/vite` plugin, no config file) |
| Web3 Wallet | Freighter API (`@stellar/freighter-api`) for Stellar Testnet payments |
| Backend | Node.js 22 + Express 5, `@stellar/stellar-sdk` for Horizon transaction verification |
| Database | PostgreSQL (tested on 15) via `pg`, plain parameterised SQL |
| Live updates | REST + polling every 2 seconds |
| Other | `express-rate-limit`; tests use Node's built-in `node:test` |

## Project structure

```
tab-bill-splitter/
├── client/                 React app (Vite + Tailwind)
│   └── src/
│       ├── pages/          HomePage (create table), TablePage, NotFound
│       ├── components/     ItemList, UnclaimedAlert, JoinCard, HostEditor, Settlement, ShareCard, …
│       ├── hooks/useTable.js   2-second polling with cleanup and stale-response protection
│       └── lib/            api client, XLM formatting, stellar wallet integration, clipboard, local secret storage
├── server/
│   ├── src/
│   │   ├── money.js        all money maths (pure functions in integer stroops)
│   │   ├── stellar.js      Horizon RPC validation and payment verification
│   │   ├── tables.js       data access + business rules (transactions, locking, settlements)
│   │   ├── routes/tables.js  thin HTTP handlers + validation
│   │   ├── app.js          Express app: JSON limits, rate limits, errors, static files
│   │   ├── migrate.js      runs migrations/*.sql once each
│   │   └── index.js        entry point (migrates, then listens)
│   ├── migrations/         001_init.sql, 002_stellar_settlement.sql, 003_stellar_native_xlm.sql
│   └── test/               money.test.js, api.test.js, stellar.test.js
├── scripts/dev.js          runs API + Vite together
├── render.yaml             Render Blueprint (not deployed)
├── .env.example
└── .node-version
```

## Local setup

### Prerequisites

- **Node.js 22.12+** (22.23.4 is pinned in `.node-version` for Render; with nvm: `nvm install 22.23.4`)
- **PostgreSQL** running locally

### 1. Create the databases

On Ubuntu/Debian, PostgreSQL lets a database user with the same name as your Linux user connect over the local socket without a password. One-time setup:

```bash
sudo -u postgres createuser --createdb "$USER"   # skip if the role already exists
createdb tab          # development data
createdb tab_test     # used (and wiped) by npm test
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

| Variable | Purpose | Default in `.env.example` |
|---|---|---|
| `DATABASE_URL` | App database | `postgresql:///tab?host=/var/run/postgresql` |
| `TEST_DATABASE_URL` | Test database — its name **must contain "test"**, because tests wipe it | `postgresql:///tab_test?host=/var/run/postgresql` |
| `DATABASE_SSL` | `true` for hosted databases that need SSL | `false` |
| `STELLAR_NETWORK` | Stellar network (`testnet`) | `testnet` |
| `STELLAR_HORIZON_URL` | Stellar Horizon URL | `https://horizon-testnet.stellar.org` |
| `PORT` | API port | `3001` |

> **Why `?host=/var/run/postgresql`?** Node's `pg` driver, unlike `psql`, doesn't fall back to the local Unix socket when the URL has no host. It would try TCP to `localhost`, which asks for a password. If you use a password instead, a normal URL works: `postgresql://user:password@localhost:5432/tab`. Never commit `.env`.

### 3. Install, migrate, run

```bash
npm install
npm run migrate      # creates the tables (safe to run repeatedly; the server also runs it on start)
npm run dev          # API on http://localhost:3001 + app on http://localhost:5174
```

Open **http://localhost:5174**. In development, Vite proxies `/api` to Express.

### Trying it with real phones

Phones can't open `localhost`. With `npm run dev`, Vite also prints a **Network** address (e.g. `http://192.168.1.14:5174`). Open the app on your laptop *using that address* when you create the table, so the share link works for phones on the same Wi-Fi. (Copy buttons fall back to a compatible method on plain-HTTP LAN addresses.)

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (with `--watch`) + Vite dev server |
| `npm run migrate` | Apply database migrations |
| `npm test` | Money unit tests, API tests, and Stellar settlement tests against `TEST_DATABASE_URL` |
| `npm run lint` | Lint the client (oxlint) |
| `npm run build` | Build the React app into `client/dist` |
| `npm start` | Production server: API + built app on `PORT` |

## Production build

```bash
npm run build
npm start            # serves client/dist and /api from one Express process
```

Any non-API path (like `/t/k7x2qm`) returns the React app, so deep links work.

## API

All responses are JSON. Errors look like `{ "error": { "code": "...", "message": "..." } }`. Write endpoints that change the bill return the full recalculated table view.

| Method & path | Who | Purpose |
|---|---|---|
| `GET /api/health` | anyone | `{ ok, database }` |
| `POST /api/tables` | anyone | Create a table `{ name?, taxPercent, tipPercent }` → view + `hostKey` (returned once) |
| `GET /api/tables/:id` | anyone | Table, items (with `claimedBy` and per-person `shares`), participants, `unclaimedItemIds`, `totals`, `viewer` |
| `PATCH /api/tables/:id` | host | Update `name`, `taxPercent`, `tipPercent` |
| `PATCH /api/tables/:id/stellar-wallet` | host | Configure host Stellar public key `{ hostWallet }` |
| `POST /api/tables/:id/items` | host | Add item `{ name, price }` (`price` in XLM, e.g. `"4.50"`) |
| `PATCH /api/tables/:id/items/:itemId` | host | Edit item name/price |
| `DELETE /api/tables/:id/items/:itemId` | host | Remove item (and its claims) |
| `POST /api/tables/:id/sample` | host | Add the sample bill in XLM |
| `POST /api/tables/:id/finalize` / `unlock` | host | Lock / unlock the bill |
| `POST /api/tables/:id/participants` | anyone | Join `{ name }` → `participantToken`; same token again returns the same person |
| `POST /api/tables/:id/claim` | participant | `{ itemId, claimed: true \| false }` — idempotent |
| `POST /api/tables/:id/payments` | participant | Submit Stellar payment `{ txHash, payerWallet }` for independent Horizon verification |

"Host" means the request carries the secret host key in an `X-Host-Key` header; "participant" means an `X-Participant-Token` header. Only SHA-256 hashes of these secrets are stored, and they are never included in table responses.

## Security notes — please read

- **Host & participant authentication:** Secrets live in the browser's `localStorage`. Only the device that created the table (holding the host key) can edit items, configure the payout wallet, or finalize.
- **Stellar payments security:**
  - Private keys and seed phrases are never handled, stored, or transmitted by the server. Transactions are signed client-side via Freighter wallet.
  - The backend never trusts client assertions: every payment is independently verified against the Stellar Testnet Horizon RPC by transaction hash, ensuring exact stroop amount, destination address, and deterministic payment memo match.
  - Payment records enforce strict PostgreSQL unique constraints on `tx_hash` to prevent double-spending or replay attacks.
- The server validates every input, uses parameterised SQL only, limits request bodies to 10 KB, rate-limits per IP, and recalculates all money itself in BigInt stroops.

## Deploying to Render (not deployed yet)

`render.yaml` is a [Render Blueprint](https://render.com/docs/blueprint-spec) that creates one free web service and one free Postgres database, with `DATABASE_URL` wired automatically. Migrations run when the server starts.

1. Create a Render account at [render.com](https://render.com) and connect your GitHub account.
2. Push this project to a GitHub repository (Render deploys from Git).
3. In the Render Dashboard, choose **New → Blueprint**, select the repository, and approve the resources in `render.yaml`.
4. When the deploy finishes, open the service URL and check `/api/health`.

Render free-tier facts, checked on **2026-10-24** at [render.com/docs/free](https://render.com/docs/free) — verify again before relying on them:

- Free Postgres databases **expire 30 days after creation**; there is a 14-day grace period to upgrade before the database **and its data are deleted**. 1 GB storage; one free database per workspace.
- Free web services **spin down after 15 minutes without traffic**, so the first request after idle is slow. 750 free instance hours per workspace per month.

Render picks the Node version from `NODE_VERSION`, then `.node-version`, then `.nvmrc`, then `package.json` `engines` ([docs](https://render.com/docs/node-version)); this repo pins 22.23.4 in `.node-version`.

## Known limitations

- Polling every 2 s, not push updates — changes can take up to ~2 s to appear on other phones.
- No quantities: "2× Chapman" is entered as two items.
- Native Stellar XLM currency only. Settlement verified on Stellar Testnet.
- Participants can't be removed or renamed once they've joined.
