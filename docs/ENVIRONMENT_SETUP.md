# ShelfSense — Environment Setup & Deployment Guide

This document covers the full environment architecture for ShelfSense: how
development, staging, and production environments are separated, how to work
safely on each, and how to clean up test data from production.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  DEVELOPMENT (Replit / local)                                        │
│  Branch : dev  (or feature branches)                                │
│  API    : localhost:3000   Web: localhost:5000                       │
│  DB     : Local PostgreSQL  OR  Neon dev branch                     │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │  Pull Request / review
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGING  (Render staging service)                                   │
│  Branch : staging                                                   │
│  API    : https://shelfsense-api-staging.onrender.com               │
│  Web    : https://shelfsense-staging.vercel.app                     │
│  DB     : Neon — SEPARATE staging project                            │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │  Approved merge to main
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PRODUCTION  (Render production service)                             │
│  Branch : main                                                      │
│  API    : https://shelfsense-api.onrender.com                        │
│  Web    : https://shelfsenseapp.com                                 │
│  DB     : Neon — production project  (REAL CUSTOMER DATA)           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Git Branch Workflow

### Branch naming convention

| Branch      | Purpose                                    | Deploys to   |
|-------------|--------------------------------------------|--------------|
| `main`      | Production-ready, stable code              | Production   |
| `staging`   | Integration/QA testing before production   | Staging      |
| `dev`       | Active development (Replit default branch) | Nowhere      |
| `feature/*` | Individual feature work                    | Nowhere      |

### Day-to-day workflow

```bash
# 1. Work on dev branch in Replit (or locally)
git checkout dev
# ... make changes, test in Replit dev environment ...
git commit -m "feat: add inventory export"
git push origin dev

# 2. When ready to test in staging, merge dev → staging
git checkout staging
git merge dev
git push origin staging
# → Render staging service auto-deploys

# 3. After staging sign-off, merge staging → main for production
git checkout main
git merge staging
git push origin main
# → Render production service auto-deploys
```

### Rules
- **Never push directly to `main`** from Replit or your local machine.
- **Never run `prisma migrate dev` or `prisma db push` against staging/production.**
  Always use `prisma migrate deploy` (applies pending migrations only).
- **Never run seed scripts in production** (they are blocked — see [Seed Protection](#seed-protection)).

---

## Environment Variables

Each environment requires its own set of environment variables.
Example files are committed to the repo:

| Environment | API example file                    | Web example file                    |
|-------------|-------------------------------------|-------------------------------------|
| Development | `apps/api/.env.development.example` | `apps/web/.env.development.example` |
| Staging     | `apps/api/.env.staging.example`     | `apps/web/.env.staging.example`     |
| Production  | `apps/api/.env.production.example`  | `apps/web/.env.production.example`  |

### For local development (Replit)
Copy the development example to `.env`:
```bash
cp apps/api/.env.development.example apps/api/.env
cp apps/web/.env.development.example apps/web/.env
```
Edit `apps/api/.env` to set `DATABASE_URL` to your local or Neon dev database.

### For staging and production (Render)
Set variables in the Render dashboard under **Environment** for each service.
Do **not** create `.env.staging` or `.env.production` files in the repo.

---

## Database Separation (Neon)

Each environment **must** use a completely separate Neon project (or at minimum a
separate database within a Neon project). Sharing databases between environments
is prohibited and actively blocked by the safety checks in `apps/api/src/config/env.ts`.

### Recommended Neon setup

| Environment | Neon project name              |
|-------------|-------------------------------|
| Development | `shelfsense-dev`               |
| Staging     | `shelfsense-staging`           |
| Production  | `shelfsense-prod`              |

### Connection string types

Neon provides two types of connection strings. Use the right one for each purpose:

| Use case                       | Connection type       |
|--------------------------------|-----------------------|
| API runtime (`DATABASE_URL`)   | **Pooled** (pgBouncer) |
| Running migrations             | **Direct** (unpooled)  |
| prod-cleanup script            | **Direct** (unpooled)  |

### Running migrations

```bash
# Apply migrations to production (use DIRECT connection string)
DATABASE_URL="postgres://user:pass@ep-xxx-direct.neon.tech/neondb?sslmode=require" \
  npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

# Apply migrations to staging
DATABASE_URL="postgres://user:pass@ep-staging-direct.neon.tech/neondb?sslmode=require" \
  npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

> **Never use** `prisma migrate dev`, `prisma db push`, or `prisma migrate reset`
> against staging or production. These can drop data.

---

## Render Deployment Setup

The `render.yaml` in the repo root defines two API services:

- **`shelfsense-api`** — production, deploys from `main` branch
- **`shelfsense-api-staging`** — staging, deploys from `staging` branch

### Environment variables to set in Render (per service)

**Production service:**
| Variable             | Value                                         |
|----------------------|-----------------------------------------------|
| `NODE_ENV`           | `production`                                  |
| `DATABASE_URL`       | Neon pooled connection (production project)   |
| `JWT_SECRET`         | Random secret ≥32 chars (keep secret)         |
| `CORS_ALLOWED_ORIGINS` | `https://shelfsenseapp.com`                 |
| `WEB_BASE_URL`       | `https://shelfsenseapp.com`                   |
| `SMTP_HOST/PORT/USER/PASS` | Your SMTP provider credentials          |
| `SMTP_FROM`          | `noreply@shelfsenseapp.com`                   |

**Staging service:**
| Variable             | Value                                          |
|----------------------|------------------------------------------------|
| `NODE_ENV`           | `staging`                                      |
| `DATABASE_URL`       | Neon pooled connection (staging project)       |
| `JWT_SECRET`         | Different random secret from production        |
| `CORS_ALLOWED_ORIGINS` | `https://shelfsense-staging.vercel.app`      |
| `WEB_BASE_URL`       | `https://shelfsense-staging.vercel.app`        |

### Vercel (frontend)

Create two Vercel projects (or use preview deployments):

**Production project** — deploy from `main`:
```
VITE_API_BASE_URL = https://shelfsense-api.onrender.com
VITE_APP_ENV     = production
```

**Staging project** — deploy from `staging`:
```
VITE_API_BASE_URL = https://shelfsense-api-staging.onrender.com
VITE_APP_ENV     = staging
```

---

## Safety Checks

The API server has built-in safety checks that **prevent starting** in dangerous configurations.

### What is checked at startup

1. **Production + localhost DB**: If `NODE_ENV=production` and `DATABASE_URL` points to
   `localhost` or `127.0.0.1`, the server **refuses to start** with a clear error.

2. **Production without DATABASE_URL**: If `NODE_ENV=production` and no `DATABASE_URL`
   is set, the server refuses to start (no silent localhost fallback in production).

3. **JWT secret in production**: If `NODE_ENV=production` and `JWT_SECRET` is missing,
   set to the default dev value, or shorter than 32 characters, the server refuses to start.

### Startup banner

Every startup prints a banner showing exactly what environment the server is in:
```
──────────────────────────────────────────────────────
  ShelfSense API — production
  DB   : ep-xxx.us-east-2.aws.neon.tech/neondb
  Port : 3000
  Web  : https://shelfsenseapp.com
  CORS : https://shelfsenseapp.com
──────────────────────────────────────────────────────
```
This makes it impossible to silently be in the wrong environment.

---

## Seed Protection

Demo seed scripts (`apps/api/prisma/seed.ts`, `apps/api/prisma/seed-plans.ts`)
**will not run in production**. They exit immediately with an error if
`NODE_ENV=production`, unless you explicitly override with:

```bash
FORCE_PROD_SEED=true npm run db:seed
```

Use `FORCE_PROD_SEED=true` only when seeding the default plan catalogue
(`seed-plans.ts`) for the first time on a brand-new production database.
**Never use it for the demo user seed (`seed.ts`).**

---

## Resetting Staging Safely

To get a clean staging database:

```bash
# 1. Drop and recreate the staging database in Neon dashboard
#    (or use a new Neon branch)

# 2. Apply all migrations
DATABASE_URL="<staging-direct-connection-string>" \
  npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

# 3. Seed the default plan catalogue (staging only)
DATABASE_URL="<staging-direct-connection-string>" \
  NODE_ENV=staging tsx apps/api/prisma/seed-plans.ts

# 4. Optionally seed demo data for testing
DATABASE_URL="<staging-direct-connection-string>" \
  NODE_ENV=staging tsx apps/api/prisma/seed.ts
```

---

## Cleaning Production Test Users

If test/dummy accounts were created in production during initial setup,
use the cleanup script to safely remove them.

### Step 1 — Dry run (always start here)

```bash
# Show what would be deleted — NO changes made
DATABASE_URL="<production-direct-connection-string>" \
  NODE_ENV=production \
  npm run prod:cleanup:dry-run
```

This prints a full inventory of all users, workspaces, and data counts.
Platform admin accounts are always protected and never shown as deletable.

### Step 2 — Delete (interactive)

```bash
# Interactive deletion with backup and confirmation
DATABASE_URL="<production-direct-connection-string>" \
  NODE_ENV=production \
  npm run prod:cleanup:delete
```

The script will:
1. Print a full inventory of all non-admin users
2. Ask you to select which to delete (by number, comma-separated, or "all")
3. **Create a JSON backup file** (`prod-cleanup-backup-<timestamp>.json`) before deleting anything
4. Require you to type `DELETE` to confirm
5. Delete selected users and all their workspace data

### What gets deleted

When a user is deleted:
- Their account and authentication data
- All workspaces they own (including all items, stock batches, stock movements,
  purchases, suppliers, locations, alerts, team members, notifications, reports)
- Their support tickets and messages
- Their memberships in workspaces they don't own

### What is NEVER deleted automatically
- Platform admin accounts (`platformRole != NONE`)
- Users in workspaces owned by someone else (only their membership is removed)

---

## Quick Reference — Commands

```bash
# Development
npm run dev                          # Start both API and web
npm run dev:api                      # Start API only
npm run dev:web                      # Start web only

# Database (development)
npm run db:migrate                   # Create + apply new migration (dev only)
npm run db:seed                      # Seed demo data (blocked in production)
npm run db:seed:plans                # Seed default plans (safe for staging)

# Database (staging/production — use direct connection string)
DATABASE_URL="..." npm run db:deploy  # Apply pending migrations only

# Cleanup
npm run prod:cleanup:dry-run         # Show deletable users (read-only)
npm run prod:cleanup:delete          # Interactively delete test users

# Verification
npm run ops:check                    # Validate env vars and schema
npm run build                        # Full production build
npm run verify                       # ops:check + build + test
```

---

## .gitignore — What is committed vs ignored

| File pattern                    | Committed? | Purpose                            |
|---------------------------------|------------|------------------------------------|
| `.env.*.example`                | ✅ Yes     | Template showing required vars     |
| `.env`                          | ❌ No      | Local development secrets          |
| `.env.local`                    | ❌ No      | Local overrides                    |
| `.env.development`              | ❌ No      | Dev secrets (if used locally)      |
| `.env.staging`                  | ❌ No      | Never store staging creds in repo  |
| `.env.production`               | ❌ No      | NEVER store production creds       |
| `prod-cleanup-backup-*.json`    | ❌ No      | Backup files from cleanup script   |

---

## Emergency Contacts

If you accidentally connect to the wrong database or delete real data:
1. Stop the service immediately on Render (manual deploy → suspend)
2. Take a Neon snapshot/backup via the Neon dashboard
3. Review `prod-cleanup-backup-<timestamp>.json` if available for data recovery
