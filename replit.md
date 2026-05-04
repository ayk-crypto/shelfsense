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
- **Email**: `nodemailer` (console transport in dev, SMTP in prod)
- **Scheduler**: `node-cron` — low-stock alerts every 4h, expiry alerts every 4h (offset), daily digest at 08:00
- **Logging**: `winston` (JSON in prod, colorized in dev); per-request structured logging with `requestId`, `userId`, `workspaceId`, `durationMs`

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
- User roles: OWNER, MANAGER, OPERATOR (route-level access control via Prisma `Role` enum)
- Custom roles system: named roles with `baseRole` + `permissions` JSON; stored in `CustomRole` table; assigned via `Membership.customRoleId`
- Inventory item tracking (SKU, barcode, unit, min stock level, expiry tracking)
- Stock batch management with expiry dates
- Stock movement tracking (STOCK_IN, STOCK_OUT, WASTAGE, ADJUSTMENT)
- Supplier contact management (name, phone, notes)
- **Purchase Order lifecycle**: DRAFT → ORDERED → PARTIALLY_RECEIVED → RECEIVED/CANCELLED; batch/expiry set at receive time only; supplier+cost intelligence auto-fills PO lines
- **Stock In two modes**: Direct (ad-hoc batches with supplier/cost/expiry) + Receive Against PO (links open POs, uses purchase receive endpoint)
- Barcode scanning via html5-qrcode (lazy-loaded, halves main bundle)
- Notifications system (unread count, mark-all-read)
- Location selector (multi-location per workspace)
- **Onboarding wizard** (6-step, with resume support): Step 0 Workspace Setup (name + `businessType` card picker) → Step 1 Business Profile (branch name, currency, phone) → Step 2 Units & Categories (chip selector, custom entries) → Step 3 Add First Items (up to 5 items, unit/category/min-stock/expiry toggle) → Step 4 Opening Stock (per-item quantity/cost/expiry) → Step 5 All Set. Dedicated `/onboarding` route; `OnboardingGuard` redirects OWNER to `/onboarding` if `onboardingCompleted` is false; `OnboardingPageWrapper` fetches settings + status. Resume: `Workspace.onboardingStep Int @default(0)` persists the current step; `PATCH /onboarding/step` saves it; `PATCH /onboarding/complete` sets `onboardingCompleted=true`.
- **Server-side reports**: 8 analytics reports at `GET /reports/{type}` — Inventory Valuation, Wastage Cost, Usage by Item, Supplier Spend, Stock Aging, Expiry Loss, Adjustment Variance, Transfer History. Each supports `dateFrom/dateTo/locationId/category/supplierId` filters and `?format=csv` streaming export. Protected by `reports:export` permission (OWNER + MANAGER).
- Reports page with CSV export
- **Subscription plan system**: 3 tiers — FREE (50 items, 1 location, 3 users), BASIC (500 items, 5 locations, 10 users), PRO (unlimited). `PlanTier` enum on `Workspace.plan` (default FREE). Limits enforced server-side on `POST /items`, `POST /locations`, `POST /team/users` with HTTP 403 + `code: "PLAN_LIMIT_REACHED"`. `GET /plan/status` returns plan + limits + live usage counts; `PATCH /plan` (OWNER only) switches tiers. Frontend: `/plan` page (OWNER-only) with plan cards + usage progress bars; "Plan" nav link in sidebar.
- Team management (invite / role change / remove)
- Activity log with filters
- Settings page (workspace name, notifications toggles, daily digest email preference)
- **Scheduled email delivery**: low-stock alert emails, expiry alert emails, and daily digest — each with per-workspace anti-spam timestamp tracking (`lastScheduledLowStockEmailAt`, `lastScheduledExpirySoonEmailAt`, `lastDailyDigestSentAt`)
- **Auth security**: account lockout after 5 failed logins (15 min), forgot/reset password (SHA-256 hashed tokens, 60 min TTL), email verification (24 h TTL), rate limiting on all auth endpoints

## Frontend Integration (`apps/web`)

- **Login page** — email/password form; "Forgot password?" link; account lockout UI
- **Landing page** (`/`) — marketing page accessible to everyone (authenticated users see "Go to app" CTAs); sticky navbar with smooth-scroll, hero with live CSS app mockup, stats bar, 6-feature grid, alerts showcase, pricing cards (Free/Basic/Pro), CTA banner, footer
- **Signup page** — workspace + user creation; redirects to `/onboarding` after signup
- **ForgotPasswordPage** (`/forgot-password`) — sends reset email
- **ResetPasswordPage** (`/reset-password`) — validates token, sets new password
- **VerifyEmailPage** (`/verify-email`) — confirms email verification token
- **Onboarding** (`/onboarding`) — 6-step wizard with resume: Workspace Setup, Business Profile, Units & Categories, Add Items (up to 5), Opening Stock, All Set + Go to Dashboard. Progress is saved to the server after each step so users can resume mid-flow on a fresh load.
- **Dashboard page** — summary stat cards + expiring-soon inventory table + cost analysis
- **Items page** (`/items`) — list all items; Add Item modal; Stock In / Stock Out modals per row; inline toast notifications; bulk actions; barcode scanner. Table actions: "+ In" (green), "− Out" (red), three-dot More menu (grouped Stock/Item/Danger sections with dividers). KPI summary pills ("active", "low stock", "archived") are clickable filters. Category shown as badge; stock quantity formatted to 2 decimal places.
- **Movements page** (`/movements`) — stock movement log with filters
- **Suppliers page** (`/suppliers`) — supplier list with Add Supplier modal
- **Purchases page** (`/purchases`) — PO lifecycle (DRAFT→ORDERED→RECEIVED); New PO modal without batch/expiry (set at receive time); PO detail shows ordered value column; supplier suggestion + unit cost auto-fill on item select
- **Stock In page** (`/stock-in`) — mode toggle: **Direct Stock In** (ad-hoc batches with supplier/cost intelligence) or **Receive Against PO** (select open PO, fill receive qty/batch/expiry per line, submits to purchase receive endpoint)
- **Reports page** (`/reports`) — filterable reports with CSV export
- **Alerts page** (`/alerts`) — low-stock and expiry alerts grouped by severity
- **Team page** (`/team`) — two-tab layout: Members (list + role management) + Custom Roles (role builder); OWNER only
- **Activity page** (`/activity`) — audit log with filters
- **Locations page** (`/locations`) — location CRUD (OWNER only)
- **Plan page** (`/plan`) — subscription tier cards (FREE/BASIC/PRO) with one-click switching, live usage progress bars per limit type (items, locations, users), at-limit / near-limit warnings (OWNER only)
- **Settings page** (`/settings`) — workspace settings and notification preferences
- **App shell** — responsive layout: sidebar on desktop (≥768px), bottom nav + topbar on mobile
- **API client** — `src/api/client.ts` fetch wrapper injects Bearer token automatically; captures `X-Request-Id` from responses and attaches it to thrown `Error` objects as `.requestId`
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

### API (`apps/api/.env`)
- `DATABASE_URL` — PostgreSQL connection string (managed by Replit in dev; Neon pooled string in prod)
- `PORT` — API port (defaults to 3000)
- `NODE_ENV` — `development` | `production`
- `JWT_SECRET` — JWT signing secret (must be ≥ 32 chars in production)
- `CORS_ALLOWED_ORIGINS` — comma-separated allowed frontend origins
- `WEB_BASE_URL` — public frontend URL used in auth email links (aliases `APP_URL`)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` — email sending (optional; console fallback in dev)
- `SMTP_FROM` — sender address for auth emails (aliases `EMAIL_FROM`)

### Web (`apps/web/.env`)
- `VITE_API_BASE_URL` — API base URL; defaults to `/api` (proxied in dev); set to full Render URL in production
- `VITE_APP_ENV` — `development` | `production`

## Database

Prisma ORM with migrations in `apps/api/prisma/migrations/`.

```bash
# Production migration (safe — never resets data)
DATABASE_URL="<neon-direct-url>" npm run migrate:prod

# Development migration
cd apps/api && npx prisma migrate dev
```

**Never run `prisma migrate dev`, `db push`, or `migrate reset` against production.**

## Development

```bash
npm install              # install all workspace dependencies
npm run dev:web          # start frontend (port 5000)
npm run dev:api          # start API (port 3000)
npm run dev              # start both concurrently
```

## Build Scripts

```bash
npm run build            # full monorepo build (shared + api + web)
npm run build:api        # API only (prisma generate + tsc)
npm run build:web        # web only (tsc + vite build)
npm run start:api        # start compiled API (node dist/index.js, binds 0.0.0.0)
npm run prisma:generate  # run prisma generate in API workspace
npm run migrate:prod     # run prisma migrate deploy (production-safe)
```

## Production Deployment

- **Frontend**: Vercel (root dir: `apps/web`, output: `dist`)
- **Backend**: Render (build: `npm install && npm run build:api`, start: `npm run start:api`)
- **Database**: Neon PostgreSQL (pooled connection string for runtime; direct for migrations)
- **SPA routing**: `apps/web/vercel.json` rewrites all routes → `index.html`

See [docs/deployment.md](docs/deployment.md) for the full deployment guide, environment variable reference, safe migration process, and rollback instructions.

## Health Checks

- `GET /api/health` — always returns `{"status":"ok"}` (lightweight)
- `GET /api/ready` — checks DB with `SELECT 1`, returns 503 if unavailable
