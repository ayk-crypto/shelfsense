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

## Design System (as of May 2026 redesign)

- **Font**: Inter (Google Fonts, 400–900)
- **Primary color**: `#6366F1` (Indigo 500) with hover `#4F46E5` and light `#EEF2FF`
- **Radius**: 10px (card), 8px (input/button)
- **Shadows**: layered, subtle
- **Logo mark**: gradient indigo `135deg #6366f1→#4f46e5`
- **Login/Onboarding background**: indigo-to-violet gradient
- **Sidebar**: `#fafafe` background with `#ede9fe` border, indigo active states
- All custom CSS in `apps/web/src/App.css` (6000+ lines, no CSS framework)

## Key Features

- Multi-tenant architecture with Workspaces
- User roles: OWNER, MANAGER, STAFF (route-level access control)
- Inventory item tracking (SKU, barcode, unit, min stock level, expiry tracking)
- Stock batch management with expiry dates
- Stock movement tracking (STOCK_IN, STOCK_OUT, WASTAGE, ADJUSTMENT)
- Supplier contact management (name, phone, notes)
- Purchase recording with multi-line items (auto-increments stock via STOCK_IN movements)
- Barcode scanning via html5-qrcode (lazy-loaded, halves main bundle)
- Notifications system (unread count, mark-all-read)
- Location selector (multi-location per workspace)
- Onboarding flow for new workspaces
- Reports page with CSV export
- Team management (invite / role change / remove)
- Activity log with filters
- Settings page (workspace name, notifications toggles)

## Frontend Integration (`apps/web`)

- **Login page** — email/password form with "Fill demo credentials" helper
- **Signup page** — workspace + user creation
- **Onboarding** — multi-step setup flow
- **Dashboard page** — summary stat cards + expiring-soon inventory table + cost analysis
- **Items page** (`/items`) — list all items; Add Item modal; Stock In / Stock Out modals per row; inline toast notifications; bulk actions; barcode scanner
- **Movements page** (`/movements`) — stock movement log with filters
- **Suppliers page** (`/suppliers`) — supplier list with Add Supplier modal
- **Purchases page** (`/purchases`) — purchase history; New Purchase modal with multi-line items
- **Reports page** (`/reports`) — filterable reports with CSV export
- **Alerts page** (`/alerts`) — low-stock and expiry alerts grouped by severity
- **Team page** (`/team`) — member list with role management (OWNER only)
- **Activity page** (`/activity`) — audit log with filters
- **Locations page** (`/locations`) — location CRUD (OWNER only)
- **Settings page** (`/settings`) — workspace settings and notification preferences
- **App shell** — responsive layout: sidebar on desktop (≥768px), bottom nav + topbar on mobile
- **API client** — `src/api/client.ts` fetch wrapper injects Bearer token automatically
- **Auth** — JWT stored in `localStorage` under `shelfsense_token`; `AuthContext` provides `user`, `saveAuth`, `logout`
- **Routing** — `ProtectedRoute` redirects unauthenticated users to `/login`; role-based guards per page
- **Vite proxy** — all API routes proxied to `http://127.0.0.1:3000`

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
