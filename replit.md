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
