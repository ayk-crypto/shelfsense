# ShelfSense

A SaaS application for smart inventory and expiry tracking targeted at small businesses.

## Architecture

This is an npm workspaces monorepo with three packages:

- **`apps/web`** — React 19 + Vite frontend (TypeScript), runs on port 5000
- **`apps/api`** — Express + Node.js backend (TypeScript), runs on port 3000
- **`packages/shared`** — Shared TypeScript types used by both apps

## Tech Stack

- **Frontend**: React 19, Vite, TypeScript
- **Backend**: Node.js, Express, TypeScript (run with `tsx`)
- **Database**: PostgreSQL (Replit built-in) with Prisma ORM
- **Auth**: JWT (`jsonwebtoken`) + `bcryptjs`

## Key Features

- Multi-tenant architecture with Workspaces
- User roles: OWNER, MANAGER, STAFF
- Inventory item tracking (SKU, barcode, unit, min stock level, expiry tracking)
- Stock batch management with expiry dates
- Stock movement tracking (STOCK_IN, STOCK_OUT, WASTAGE, ADJUSTMENT)
- Supplier contact management (name, phone, notes)
- Barcode scanning via html5-qrcode (lazy-loaded, halves main bundle)

## Frontend Integration (`apps/web`)

- **Login page** — email/password form with "Fill demo credentials" helper
- **Dashboard page** — summary stat cards + expiring-soon inventory table
- **Items page** (`/items`) — list all items; Add Item modal; Stock In / Stock Out modals per row; inline toast notifications
- **Movements page** (`/movements`) — stock movement log with filters
- **Suppliers page** (`/suppliers`) — supplier list with Add Supplier modal; tappable phone links; mobile card layout
- **Alerts page** (`/alerts`) — low-stock and expiry alerts
- **App shell** — responsive layout with sidebar on desktop (≥768px), bottom nav on mobile; Dashboard, Items, Movements, Suppliers, Alerts nav links
- **API client** — `src/api/client.ts` fetch wrapper injects Bearer token automatically
- **Auth** — JWT stored in `localStorage` under `shelfsense_token`; `AuthContext` provides `user`, `saveAuth`, `logout`
- **Routing** — `ProtectedRoute` redirects unauthenticated users to `/login`; login redirects to `/dashboard`
- **Env** — `apps/web/.env` sets `VITE_API_BASE_URL=/api` (proxied by Vite dev server to `http://localhost:3000`)
- **Types** — `src/vite-env.d.ts` declares `ImportMeta.env` for TypeScript; shared Prisma types from `packages/shared`

### Demo account
- Email: `demo@shelfsense.local`
- Password: `demo123456`

## Workflows

- **Start application** — `npm run dev:web` on port 5000 (webview)
- **Start API** — `npm run dev:api` on port 3000 (console)

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (managed by Replit)
- `PORT` — API port (set to 3000)
- `JWT_SECRET` — JWT signing secret (defaults to "development-secret" in dev)

## Database

Prisma ORM with migrations in `apps/api/prisma/migrations/`. Run migrations with:
```
cd apps/api && npx prisma migrate deploy
```

## Development

```bash
npm install              # install all workspace dependencies
npm run dev:web          # start frontend (port 5000)
npm run dev:api          # start API (port 3000)
npm run dev              # start both concurrently
```

## Deployment

Configured as autoscale deployment:
- **Build**: `npm install && npm run build`
- **Run**: `node apps/api/dist/index.js`
