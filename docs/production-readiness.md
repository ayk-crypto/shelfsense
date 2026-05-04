# ShelfSense Production Readiness

This document summarises the current product surface and the remaining work needed before treating ShelfSense as a fully hardened production system.

## Completed Modules

- Authentication with JWT-based login (7-day tokens, HS256, issuer/audience claims).
- Password reset flow — hashed token (SHA-256), 60-minute TTL, single-use, timing-safe email enumeration protection.
- Email verification flow — hashed token (SHA-256), 24-hour TTL, single-use, resend endpoint.
- Account lockout after 5 failed login attempts (15-minute cooldown, DB-backed).
- Per-endpoint rate limiting: login 10/15 min, forgot-password / reset-password / resend-verification 5/15 min, global 300/15 min.
- Structured logging via Winston (JSON in production, colorised in development) with `logAuthEvent`, `logSecurityEvent`, and `logRequest` helpers.
- Per-request structured logging: every HTTP request emits a `[REQUEST]` log line with `requestId`, `method`, `path`, `status`, `durationMs`, `userId`, and `workspaceId`.
- Request ID middleware: every response includes an `X-Request-Id` header (UUID v4); the ID is echoed in error response bodies and forwarded to the frontend `Error` object.
- Error responses include a machine-readable `code` field (e.g. `NOT_FOUND`, `UNAUTHORIZED`, `INTERNAL_ERROR`) and the `requestId`.
- Email service (nodemailer) — SMTP in production, safe console fallback in development.
- Workspace-aware multi-tenant data model.
- Role-based access control: OWNER, MANAGER, OPERATOR with `requireRole` middleware.
- Custom roles with granular `permissions[]` array enforced by `requirePermission` middleware.
- Team management for OWNER users.
- Workspace settings (name, currency, low-stock multiplier, expiry-alert days, per-alert email toggles).
- Multi-location branch support with location selector and location management.
- Global item catalogue per workspace.
- Stock batch management with expiry dates.
- Stock In (direct and receive-against-PO), Stock Out, manual adjustments, inter-location transfers.
- Low-stock, expiring-soon, and expired-stock alerts with per-type in-app and email notification toggles.
- Alert digest email — workspace-level deduplication (fires at most once per alert type per calendar day, regardless of how many users or page loads trigger the check).
- Scheduled email notifications via node-cron: low-stock alerts every 4 hours, expiry alerts every 4 hours (offset), daily inventory summary digest at 08:00 — each with per-workspace anti-spam cooldown tracking (`lastScheduledLowStockEmailAt`, `lastScheduledExpirySoonEmailAt`, `lastDailyDigestSentAt`).
- Daily digest email preference (`dailyDigestEnabled`) — workspace owner can opt in to a once-per-day combined summary covering all active stock issues.
- Supplier management and Purchase Order lifecycle (DRAFT → ORDERED → PARTIALLY_RECEIVED → RECEIVED/CANCELLED).
- Barcode label generation and camera scanning (html5-qrcode, lazy-loaded).
- Dashboard overview, alert summary, reorder suggestions, usage insights, stock forecast, cost analysis, and wastage summary.
- Server-side business analytics reports with date, location, category, and supplier filters — see [Available Reports](#available-reports) below.
- CSV export for all 8 reports, streamed from the API with auth token (no client-side generation).
- Legacy CSV report exports for stock summary, stock movements, and purchases.
- Audit logging for core item, stock, transfer, purchase, and supplier actions.
- Notifications system (unread badge, mark-all-read, bell panel).
- Persistent email-verification banner in the app shell for unverified users.

## Available Reports

All reports are served from `GET /reports/{type}` and require the `reports:export` permission (OWNER and MANAGER roles). Responses include `{ summary, rows, generatedAt }`. Append `?format=csv` to any endpoint to stream a CSV file instead.

### Common filter parameters

| Parameter    | Type   | Description                                              |
|-------------|--------|----------------------------------------------------------|
| `dateFrom`  | date   | ISO date (YYYY-MM-DD); filters on `createdAt` or `date` |
| `dateTo`    | date   | ISO date (YYYY-MM-DD); inclusive upper bound             |
| `locationId`| UUID   | Limit to a single workspace location                    |
| `itemId`    | UUID   | Limit to a specific item                                |
| `category`  | string | Exact match on `item.category`                          |
| `supplierId`| UUID   | Supplier Spend only — limit to one supplier              |

### Report endpoints

| Endpoint                         | Description                                                                 |
|----------------------------------|-----------------------------------------------------------------------------|
| `GET /reports/inventory-valuation` | Current stock value — remaining quantity × unit cost, grouped by item. Summary: total items, quantity, value. |
| `GET /reports/wastage-cost`       | WASTAGE movements aggregated by item — total qty wasted and imputed cost.  |
| `GET /reports/usage`              | STOCK_OUT movements per item — consumption totals and last-used date.      |
| `GET /reports/supplier-spend`     | Purchases (non-draft, non-cancelled) grouped by supplier — total spend, order count, avg order value. |
| `GET /reports/stock-aging`        | Open batches sorted by age — highlights stale or slow-moving inventory.    |
| `GET /reports/expiry-loss`        | Expired batches with remaining quantity — potential write-off value.        |
| `GET /reports/adjustment-variance`| ADJUSTMENT movements per item — gains vs losses, net variance.             |
| `GET /reports/transfers`          | TRANSFER_IN / TRANSFER_OUT movements — full history with location and note. |

Row limit: 1,000 rows per request. For larger datasets, apply date or category filters to narrow the result set.

## MVP-Ready Areas

- Local development setup using npm workspaces.
- Prisma migrations and seed data for demo usage.
- Core inventory workflows for small teams.
- Owner, manager, and operator role separation in the UI and API.
- Basic branch-level stock filtering and transfers.
- Server-side business analytics with 8 exportable reports and CSV streaming.
- Clear demo accounts for evaluation and onboarding.

## Not Production-Ready Yet

- No refresh token rotation, session revocation, or active session management.
- No multi-factor authentication (TOTP or SMS).
- No CAPTCHA or adaptive brute-force protection beyond account lockout.
- No formal automated test suite or CI gate.
- No metrics, distributed tracing, or external error-tracking integration (e.g. Sentry).
- No automated backup scheduling in the repository (manual steps documented in the Logging and Monitoring section).
- No deployment-specific hardening guide for TLS termination or secret rotation.
- No push notification delivery (WhatsApp / browser push channels are placeholders).
- No edit/delete flows for team members or locations.
- Limited audit coverage beyond the currently logged core actions.
- No advanced forecasting, charting, or machine-learning prediction.

## Security Checklist

- Use a long random `JWT_SECRET` (≥ 32 chars) in every non-local environment.
- Store `DATABASE_URL`, `JWT_SECRET`, and deployment secrets in a secret manager.
- Ensure production traffic uses HTTPS only.
- Configure `CORS_ALLOWED_ORIGINS` with only trusted frontend origins.
- Set `SMTP_*` environment variables and `APP_URL` before enabling self-service onboarding so auth emails are delivered.
- Add refresh token rotation or another session revocation strategy before public launch.
- Review all OWNER-only routes before launch.
- Confirm API responses never expose password hashes or sensitive tokens.
- Review audit logs for sensitive metadata before broadening log coverage.
- Keep request body limits small unless a route explicitly needs larger payloads.

## Deployment Checklist

- Provision a production PostgreSQL or Neon database.
- Apply migrations: `cd apps/api && npx prisma migrate deploy`.
- Generate Prisma client during the API build.
- Set required API environment variables:
  - `DATABASE_URL`
  - `JWT_SECRET` (long random string)
  - `PORT`
  - `CORS_ALLOWED_ORIGINS` (production frontend origin)
- Set optional email environment variables (required for auth emails):
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
  - `EMAIL_FROM`, `EMAIL_FROM_NAME`
  - `APP_URL` (public base URL, e.g. `https://app.shelfsense.io`)
- Set web environment variable: `VITE_API_BASE_URL`.
- Build all workspaces: `npm run build`.
- Run the API with the compiled entrypoint: `node apps/api/dist/index.js`.
- Serve the Vite build output from `apps/web/dist`.
- Verify login, forgot/reset password, email verification, dashboard, items, stock in/out, purchases, reports, settings, locations, and audit logs in the deployed environment.
- Confirm the frontend can reach the API without proxy-only development assumptions.

## Email / SMTP Setup

In development, if no SMTP credentials are provided, all auth email links (password reset, email verification) are printed to the API console log. This allows testing the full auth flow without an email provider.

In production, configure the following in your environment or secret manager:

| Variable | Description | Example |
|---|---|---|
| `SMTP_HOST` | SMTP server hostname | `smtp.sendgrid.net` |
| `SMTP_PORT` | SMTP port (TLS: 465, STARTTLS: 587) | `587` |
| `SMTP_USER` | SMTP username / API key | `apikey` |
| `SMTP_PASS` | SMTP password / API key value | `SG.xxx…` |
| `EMAIL_FROM` | Sender address | `noreply@shelfsense.app` |
| `EMAIL_FROM_NAME` | Sender display name | `ShelfSense` |
| `APP_URL` | Public frontend base URL for email links | `https://app.shelfsense.io` |

If `SMTP_HOST` is absent in production, the API logs a configuration error and skips sending — auth tokens are **never** exposed to end users in that scenario.

## Auth Flow Reference

### Password Reset
1. User submits email on `/forgot-password`.
2. API generates a 32-byte random token, hashes it (SHA-256), stores the hash with a 60-minute expiry.
3. Raw token is sent by email as a link: `APP_URL/reset-password?token=<raw>`.
4. User submits new password on `/reset-password`. API hashes the incoming token, looks up the hash, verifies it is unused and unexpired, updates the password, marks the token used.
5. Response is always generic — the API never reveals whether an email is registered.

### Email Verification
1. On registration, a 32-byte token is generated, hashed, and stored with a 24-hour expiry.
2. Verification link (`APP_URL/verify-email?token=<raw>`) is sent by email.
3. User visits the link. API hashes the token, looks up the record, marks `emailVerified = true` and `usedAt = now`.
4. Resend endpoint generates a fresh token (previous token is superseded).

## Backup Considerations

- Enable automated database backups in Neon or the chosen PostgreSQL provider.
- Document restore steps and test restores on a non-production database.
- Take a backup before applying migrations that modify required fields, enums, or relations.
- Keep seed data separate from production data workflows.
- Define retention requirements for audit logs and operational history.

## Logging and Monitoring Considerations

- Structured JSON request logging is active in production via Winston.
- Every request receives a unique `X-Request-Id` header (UUID v4). The request ID is propagated to structured log lines, error response bodies, and the frontend `Error` object's `.requestId` property.
- Per-request structured log lines include: `requestId`, `method`, `path`, `status`, `durationMs`, `userId`, `workspaceId`.
- Auth events (login success/fail, lockout, password reset, email verification) are logged via `logAuthEvent`.
- Permission-denied responses are logged via `logSecurityEvent`.
- Error response bodies include a machine-readable `code` field (e.g. `"NOT_FOUND"`, `"UNAUTHORIZED"`, `"INTERNAL_ERROR"`) alongside `error` and `requestId`.
- Health check: `GET /api/health` — returns `{ "status": "ok" }`.
- Readiness check: `GET /api/ready` — checks database connectivity, returns 503 if the database is unavailable.
- Add an external error-tracking service (e.g. Sentry) to capture uncaught exceptions and rejected promises. Pass `requestId` as a tag for cross-referencing logs.
- Monitor API latency, error rate, and database connection failures.
- Alert on migration failures, elevated 500 responses, and database capacity limits.

### Rolling back a bad deployment

1. Revert the application code to the previous release tag.
2. If the deployment included a Prisma migration, run `npx prisma migrate resolve --rolled-back <migration-name>` on the production database to mark it as rolled back, then apply a corrective migration.
3. For data-destructive migrations, restore from the pre-migration database backup before running the rollback migration.
4. Verify `GET /api/ready` returns 200 after restoring.

### Database backup and restore

| Task | Command |
|---|---|
| Manual backup (Neon) | Use the Neon Console → Branches → Create branch (point-in-time) |
| Export via pg_dump | `pg_dump $DATABASE_URL -Fc -f shelfsense_$(date +%Y%m%d).dump` |
| Restore from dump | `pg_restore -d $DATABASE_URL -Fc shelfsense_<date>.dump` |
| Apply migrations | `cd apps/api && npx prisma migrate deploy` |

- Test restores against a non-production database before relying on them in an incident.
- Take a backup before every migration that adds or removes required columns, changes enums, or alters relations.

## Known Limitations

- Forecasting is based on simple recent-usage calculations, not demand modelling.
- Reports are generated client-side and may need server-side exports for larger datasets.
- Multi-location support filters core stock flows but operational edge cases should be tested with real branch data.
- The app assumes trusted workspace administration by OWNER users.
- There is no file-attachment support for supplier invoices or purchase documents.
- Local development uses Vite proxy behaviour that must be replaced or mirrored by production routing.
