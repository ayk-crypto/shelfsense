# ShelfSense

A SaaS application for smart inventory and expiry tracking targeted at small businesses.

## Run & Operate

**To start development:**
- `npm install`
- `npm run dev` (starts both frontend and API concurrently)

**To run in production:**
- `npm run build`
- `npm run start:api` (for the backend)

**Key Commands:**
- `npm run dev:web`: Start frontend (port 5000)
- `npm run dev:api`: Start API (port 3000)
- `npm run build:api`: Build API
- `npm run build:web`: Build web
- `npm run prisma:generate`: Generate Prisma client
- `npm run migrate:prod`: Apply production database migrations
- `npm run make:super-admin -- email@example.com`: Promote a user to SUPER_ADMIN role

**Environment Variables:**
- `apps/api/.env`: `DATABASE_URL`, `PORT`, `NODE_ENV`, `JWT_SECRET`, `CORS_ALLOWED_ORIGINS`, `WEB_BASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `PAYMENT_PROVIDER`
- `apps/web/.env`: `VITE_API_BASE_URL`, `VITE_APP_ENV`

## Stack

- **Frameworks**: React 19 (frontend), Express.js (backend)
- **Runtime**: Node.js (TypeScript with `tsx`)
- **ORM**: Prisma (PostgreSQL)
- **Validation**: _Populate as you build_
- **Build Tool**: Vite (frontend)
- **Auth**: JWT, bcryptjs
- **Scheduler**: node-cron
- **Logging**: winston

## Where things live

- `apps/web/`: Frontend application (React, Vite)
- `apps/api/`: Backend application (Node.js, Express)
- `packages/shared/`: Shared TypeScript types
- `apps/api/prisma/schema.prisma`: Database schema
- `apps/web/src/App.css`: Custom CSS for frontend styling
- `apps/api/src/lib/payment-provider/`: Payment gateway abstraction
- `docs/deployment.md`: Full deployment guide and environment variable reference

## Architecture decisions

- **Monorepo Structure**: Uses npm workspaces to manage `web`, `api`, and `shared` packages.
- **Multi-tenancy**: Implemented via Workspaces, with distinct access control for platform administration (`platformRole`) and workspace operations (`role`).
- **Onboarding Workflow**: A mandatory 6-step wizard plus plan selection, enforced by `OnboardingGuard` to ensure completion before full app access.
- **Payment Gateway Abstraction**: A modular `payment-provider` interface allows easy switching or adding payment providers (mock, PayFast, Safepay stubs).
- **Scheduled Tasks with Anti-Spam**: Critical alerts (low-stock, expiry) and daily digests are scheduled, with per-workspace timestamps to prevent spamming.

## Product

- **Inventory Management**: SKU, barcode, min stock, expiry tracking, batch management, stock movement logging (in, out, wastage, adjustment).
- **Purchase Order System**: Lifecycle management (DRAFT to RECEIVED/CANCELLED) with supplier and cost intelligence.
- **Reporting**: 8 server-side analytics reports with CSV export (e.g., Inventory Valuation, Wastage Cost).
- **Subscription Management**: Tiered plans (FREE, BASIC, PRO) with server-side limit enforcement and a dedicated plan selection/management UI.
- **User & Access Control**: Multi-level roles (OWNER, MANAGER, OPERATOR) and a custom role builder with granular permissions.
- **Platform Administration**: Dedicated `/admin` panel for SUPER_ADMINs with isolated UI and comprehensive management features for workspaces and users.
- **Notifications**: In-app notifications and scheduled email alerts for low stock, expiring items, and daily digests.
- **Onboarding**: Guided setup process for new workspaces, including plan selection.

## User preferences

_Populate as you build_

## Gotchas

- **Database Migrations**: Never run `prisma migrate dev`, `db push`, or `migrate reset` against production environments. Use `npm run migrate:prod` for production.
- **Auth Tokens**: JWTs are stored in `localStorage` under `shelfsense_token`.
- **API Client Errors**: The frontend API client attaches `X-Request-Id` from backend responses to thrown `Error` objects for easier debugging.

## Pointers

- [React documentation](https://react.dev/learn)
- [Express.js documentation](https://expressjs.com/en/guide/routing.html)
- [Prisma documentation](https://www.prisma.io/docs/)
- [Vite documentation](https://vitejs.dev/guide/)
- [Replit database setup](https://docs.replit.com/hosting/databases)