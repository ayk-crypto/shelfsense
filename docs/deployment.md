# ShelfSense — Production Deployment Guide

This guide covers deploying ShelfSense to:

- **Frontend**: [Vercel](https://vercel.com)
- **Backend API**: [Render](https://render.com)
- **Database**: [Neon](https://neon.tech) (serverless PostgreSQL)

---

## Architecture overview

```
Browser
  └── Vercel (React SPA, apps/web)
        └── VITE_API_BASE_URL ──► Render (Express API, apps/api)
                                        └── DATABASE_URL ──► Neon PostgreSQL (pooled)
                                        └── DIRECT_URL   ──► Neon PostgreSQL (direct, migrations only)
```

---

## 1. Neon — Production database setup

1. Create a [Neon](https://neon.tech) project and note **both** connection strings.
2. From **Connection Details**:
   - Copy the **Pooled connection string** → set as `DATABASE_URL` on Render (used at runtime via pgBouncer)
   - Copy the **Direct connection string** → set as `DIRECT_URL` on Render (used only for `prisma migrate deploy` during build)

> **Why two URLs?** Neon's pooled endpoint routes through pgBouncer, which does not support DDL statements (schema changes). `prisma migrate deploy` must use the direct connection. Prisma automatically uses `DIRECT_URL` for migrations and `DATABASE_URL` for queries — this is configured in `apps/api/prisma.config.ts`.

> **Important:** Neon includes `?sslmode=require` in both connection strings automatically. Do not append `?schema=public` — the default public schema is used.

---

## 2. Render — API setup

### Create a new Web Service

1. Go to [Render](https://render.com) → **New → Web Service**
2. Connect your GitHub/GitLab repository
3. Configure:

| Setting | Value |
|---------|-------|
| **Root directory** | *(leave blank — monorepo root)* |
| **Runtime** | Node |
| **Build command** | `npm install && npm run migrate:prod && npm run build:api` |
| **Start command** | `npm run start:raw --workspace @shelfsense/api` |
| **Node version** | 20+ (set in Render environment settings) |

> **Why migrations in the build step?** Running `prisma migrate deploy` during the build means a failed migration aborts the deploy entirely — the running service is never replaced with broken code. This is safer than running migrations on start, where failures can be silently swallowed.

> The `render.yaml` in this repo already encodes the correct build and start commands for both production and staging. If you connect the repo to Render's Blueprint feature, it will pick these up automatically.

### Environment variables (Render dashboard)

Set all of these under **Environment → Environment Variables**:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon **pooled** connection string (runtime queries) |
| `DIRECT_URL` | Neon **direct** connection string (migrations during build) |
| `JWT_SECRET` | Random secret ≥ 32 chars (generate below) |
| `CORS_ALLOWED_ORIGINS` | Your Vercel frontend URL, e.g. `https://shelfsense.vercel.app` |
| `WEB_BASE_URL` | Same as `CORS_ALLOWED_ORIGINS` value |
| `SMTP_HOST` | Your SMTP provider host |
| `SMTP_PORT` | `587` (TLS) or `465` (SSL) |
| `SMTP_USER` | SMTP username / email |
| `SMTP_PASS` | SMTP password or app password |
| `SMTP_FROM` | `noreply@yourdomain.com` |

**Generate `JWT_SECRET`:**

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Health check

Render can use the `/api/health` endpoint as the health check URL:

- **Health check path**: `/api/health`
- **Expected response**: `{"status":"ok"}`

The `/api/ready` endpoint checks database connectivity and schema completeness (tables + critical columns), returning `503` with details if anything is missing.

---

## 3. Vercel — Frontend setup

### Create a new Vercel project

1. Go to [Vercel](https://vercel.com) → **Add New → Project**
2. Import your repository
3. Configure:

| Setting | Value |
|---------|-------|
| **Framework Preset** | Vite |
| **Root directory** | `apps/web` |
| **Build command** | `npm run build` *(or leave default — Vercel detects Vite)* |
| **Output directory** | `dist` |
| **Install command** | `npm install` |

> Setting **Root directory** to `apps/web` scopes the Vercel project to the frontend app only.

### Environment variables (Vercel dashboard)

| Variable | Value |
|----------|-------|
| `VITE_API_BASE_URL` | Your Render API URL, e.g. `https://shelfsense-api.onrender.com` |
| `VITE_APP_ENV` | `production` |

> **No trailing slash** on `VITE_API_BASE_URL`. The API client appends paths directly: `${VITE_API_BASE_URL}/auth/login`.

### SPA routing

The `apps/web/vercel.json` file rewrites all routes to `index.html` so React Router handles client-side navigation. This file is already committed — no extra Vercel configuration is needed.

---

## 4. Required environment variables — reference

### API (Render)

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | ✅ | Must be `production` |
| `DATABASE_URL` | ✅ | Neon **pooled** connection string — used for all runtime queries |
| `DIRECT_URL` | ✅ | Neon **direct** connection string — used only by `prisma migrate deploy` during build |
| `JWT_SECRET` | ✅ | ≥ 32 char random string for signing JWTs |
| `CORS_ALLOWED_ORIGINS` | ✅ | Comma-separated list of allowed frontend origins |
| `WEB_BASE_URL` | ✅ | Public frontend URL used in auth email links |
| `PORT` | — | Set automatically by Render |
| `SMTP_HOST` | ⚠️ | Required for password reset / email verification emails |
| `SMTP_PORT` | ⚠️ | Default `587` |
| `SMTP_USER` | ⚠️ | SMTP username |
| `SMTP_PASS` | ⚠️ | SMTP password |
| `SMTP_FROM` | ⚠️ | Sender address, e.g. `noreply@yourdomain.com` |

### Web (Vercel)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_BASE_URL` | ✅ | Full URL of the Render API (no trailing slash) |
| `VITE_APP_ENV` | — | Set to `production` for production builds |

---

## 5. Safe migration process

> **Rule:** Only ever use `prisma migrate deploy` against production/staging. Never use `migrate dev`, `db push`, or `migrate reset`.

### Standard migration workflow

1. **Develop locally** — make schema changes in `apps/api/prisma/schema.prisma`
2. **Create a migration locally** (uses your local dev DB):
   ```bash
   cd apps/api
   npx prisma migrate dev --name describe_your_change
   ```
3. **Commit** the generated migration file (`prisma/migrations/<timestamp>_<name>/migration.sql`) to source control
4. **Push to main/staging** — Render's build step automatically runs `npm run migrate:prod` which calls `prisma migrate deploy`, applying the new migration against the production/staging DB using `DIRECT_URL`

### Emergency manual migration (if needed)

If you ever need to apply migrations manually outside of a Render deploy:

```bash
# From monorepo root — uses DIRECT_URL (non-pooled) for DDL safety
DIRECT_URL="postgres://user:pass@ep-xxx-direct.neon.tech/neondb?sslmode=require" \
  npm run migrate:prod
```

---

## 6. Deployment checklist

### Before first deployment

- [ ] Neon project created, **both** pooled and direct connection strings saved
- [ ] `DATABASE_URL` (pooled) set in Render
- [ ] `DIRECT_URL` (direct/non-pooled) set in Render
- [ ] `JWT_SECRET` generated (≥ 32 chars) and set in Render
- [ ] `CORS_ALLOWED_ORIGINS` set to your Vercel domain
- [ ] `WEB_BASE_URL` set to your Vercel domain
- [ ] SMTP credentials configured (or accepted that auth emails go to logs only)
- [ ] `VITE_API_BASE_URL` set in Vercel to your Render API URL

### Every deployment (automated via render.yaml)

- [ ] Render build runs: `npm install && npm run migrate:prod && npm run build:api`
- [ ] Verify `/api/health` returns `{"status":"ok"}` after deploy
- [ ] Verify `/api/ready` returns `{"status":"ready","schema":"ok","missingColumns":[]}`
- [ ] Smoke test: login, navigate dashboard, check inventory

---

## 7. Rollback

### API rollback

Render keeps previous deploys available:

1. Go to Render → your Web Service → **Deploys**
2. Find the last working deploy and click **Redeploy**

> If a migration was applied and you need to roll back the code, the migration stays applied — migrations are forward-only. Write a new migration to undo schema changes if needed.

### Frontend rollback

Vercel keeps all previous deployments available:

1. Go to Vercel → your project → **Deployments**
2. Find the last working deployment → three-dot menu → **Promote to Production**

---

## 8. Build commands reference

| Command | Description |
|---------|-------------|
| `npm run build` | Build shared + API + web (full monorepo build) |
| `npm run build:api` | Build API only (`prisma generate` + `tsc`) |
| `npm run build:web` | Build web only (`tsc` + `vite build`) |
| `npm run migrate:prod` | Run `prisma migrate deploy` via `DIRECT_URL` — production-safe only |
| `npm run prisma:generate` | Run `prisma generate` in the API workspace |

---

## 9. Local production simulation

To test the production build locally before deploying:

```bash
# 1. Build everything
npm run build

# 2. Start the API in production mode (use direct URL locally since there is no pooler)
NODE_ENV=production \
  DATABASE_URL="postgres://..." \
  DIRECT_URL="postgres://..." \
  JWT_SECRET="..." \
  CORS_ALLOWED_ORIGINS="http://localhost:4173" \
  node apps/api/dist/index.js

# 3. Preview the web build
cd apps/web && npx vite preview --port 4173
```

The Vite preview server serves the compiled `dist/` and routes all paths to `index.html`.
