# ShelfSense Production Readiness

This document summarizes the current product surface and the remaining work needed before treating ShelfSense as a hardened production system.

## Current Completed Modules

- Authentication with JWT-based login.
- Workspace-aware data model.
- Role-based access control for OWNER, MANAGER, and OPERATOR.
- Team management for OWNER users.
- Workspace settings for business name, currency, low stock multiplier, and expiry alert days.
- Multi-location branch support with location selector and location management.
- Global item catalog per workspace.
- Stock summary, stock in, stock out, manual adjustments, and stock transfers between locations.
- Low stock, expiring soon, and expired stock alerts.
- Supplier management.
- Purchase creation and purchase listing.
- Barcode label and scanning workflows.
- Dashboard overview, alert summary, reorder suggestions, usage insights, stock forecast, cost analysis, and wastage summary.
- CSV report exports for stock summary, stock movements, and purchases.
- Audit logging for core item, stock, transfer, purchase, and supplier actions.

## MVP-Ready Areas

- Local development setup using npm workspaces.
- Prisma migrations and seed data for demo usage.
- Core inventory workflows for small teams.
- Owner, manager, and operator role separation in the UI and API.
- Basic branch-level stock filtering and transfers.
- Basic reporting through client-side CSV exports.
- Clear demo accounts for evaluation and onboarding.

## Not Production-Ready Yet

- No refresh token rotation, session revocation, or active session management.
- No password reset, email verification, or multi-factor authentication.
- Rate limiting is basic; there is no account lockout, CAPTCHA, or adaptive brute-force protection.
- No formal automated test suite or CI gate documented.
- No centralized logging, metrics, alerting, or error tracking.
- No backup and restore automation in the repository.
- No deployment-specific hardening guide for CORS, TLS termination, or secret rotation.
- No background job system for scheduled expiry checks, reporting, or notifications.
- No edit/delete flows for team members or locations.
- Limited audit coverage beyond the currently logged core actions.
- No advanced forecasting, charting, or machine learning prediction.

## Security Checklist

- Use a long random `JWT_SECRET` in every non-local environment.
- Store `DATABASE_URL`, `JWT_SECRET`, and deployment secrets in a secret manager.
- Ensure production traffic uses HTTPS only.
- Configure CORS to allow only trusted frontend origins.
- Add rate limiting for login and write-heavy API routes.
- Add password reset and email verification before open self-service onboarding.
- Add refresh token rotation or another session revocation strategy.
- Review all OWNER-only routes before launch.
- Confirm API responses never expose password hashes or sensitive tokens.
- Review audit logs for sensitive metadata before broadening log coverage.
- Configure `CORS_ALLOWED_ORIGINS` with only trusted frontend origins.
- Keep API rate limits enabled, and tune stricter `/auth` limits for the deployed traffic profile.
- Keep request body limits small unless a route explicitly needs larger payloads.

## Deployment Checklist

- Provision a production PostgreSQL or Neon database.
- Apply migrations with a production-safe command such as `prisma migrate deploy`.
- Generate Prisma client during the API build.
- Set API environment variables: `DATABASE_URL`, `JWT_SECRET`, and `PORT`.
- Set `CORS_ALLOWED_ORIGINS` to the production frontend origin list.
- Set web environment variable: `VITE_API_BASE_URL`.
- Build all workspaces with `npm run build`.
- Run the API with the compiled entrypoint from `apps/api/dist`.
- Serve the Vite build output from `apps/web/dist`.
- Verify login, dashboard, items, stock out, stock in, purchases, reports, settings, locations, and audit logs in the deployed environment.
- Confirm the frontend can reach the API without proxy-only development assumptions.

## Backup Considerations

- Enable automated database backups in Neon or the chosen PostgreSQL provider.
- Document restore steps and test restores on a non-production database.
- Take a backup before applying migrations that modify required fields, enums, or relations.
- Keep seed data separate from production data workflows.
- Define retention requirements for audit logs and operational history.

## Logging and Monitoring Considerations

- Add structured request logging for API requests.
- Capture uncaught exceptions and rejected promises through an error tracking service.
- Monitor API latency, error rate, and database connection failures.
- Track failed login attempts and permission-denied responses.
- Add health checks for API uptime and database connectivity.
- Alert on migration failures, elevated 500 responses, and database capacity limits.

## Known Limitations

- Forecasting is based on simple recent usage calculations, not demand modeling.
- Reports are generated client-side and may need server-side exports for larger datasets.
- Multi-location support filters core stock flows, but operational edge cases should be tested with real branch data.
- The app assumes trusted workspace administration by OWNER users.
- There is no file attachment support for supplier invoices or purchase documents.
- Local development uses Vite proxy behavior that must be replaced or mirrored by production routing.
