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
                                        └── DATABASE_URL ──► Neon PostgreSQL
```

---

## 1. Neon — Production database setup

1. Create a [Neon](https://neon.tech) project and note the connection strings.
2. From **Connection Details**, copy the **Pooled connection string** — use this for `DATABASE_URL` on Render (pgBouncer-compatible).
3. Copy the **Direct connection string** as well — use this when running migrations (`prisma migrate deploy` requires a direct connection, not a pooled one).

> **Important:** Neon requires `?sslmode=require` (already included in the connection strings they provide). Do not use `?schema=public` with Neon — the default public schema is used automatically.

### Run the initial migration

From your local machine (or CI), run migrations against the production database using the **direct** connection string:

```bash
DATABASE_URL="postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require" \
  npm run migrate:prod
```

Or in the API workspace directly:

```bash
cd apps/api
DATABASE_URL="..." npx prisma migrate deploy
```

> `prisma migrate deploy` only applies pending migrations. It never resets or drops data. **Never run `prisma migrate dev`, `prisma db push`, or `prisma migrate reset` against production.**

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
| **Build command** | `npm install && npm run build:api` |
| **Start command** | `npm run start:api` |
| **Node version** | 20+ (set in Render environment settings) |

### Environment variables (Render dashboard)

Set all of these under **Environment → Environment Variables**:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon **pooled** connection string |
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

The `/api/ready` endpoint also checks database connectivity and returns `503` if the database is unreachable — useful for readiness probes.

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

> Setting **Root directory** to `apps/web` scopes the Vercel project to the frontend app only. Vercel will run `npm install` and `vite build` from that directory.

### Environment variables (Vercel dashboard)

| Variable | Value |
|----------|-------|
| `VITE_API_BASE_URL` | Your Render API URL, e.g. `https://shelfsense-api.onrender.com` |
| `VITE_APP_ENV` | `production` |

> **No trailing slash** on `VITE_API_BASE_URL`. The API client appends paths directly: `${VITE_API_BASE_URL}/auth/login`.

### SPA routing

The `apps/web/vercel.json` file rewrites all routes to `index.html` so React Router handles client-side navigation:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

This file is already committed — no extra Vercel configuration is needed.

---

## 4. Required environment variables — reference

### API (Render)

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | ✅ | Must be `production` |
| `DATABASE_URL` | ✅ | Neon pooled PostgreSQL connection string |
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

> **Rule:** Only use `prisma migrate deploy` in production. Never use `migrate dev`, `db push`, or `migrate reset`.

### Standard migration workflow

1. **Develop locally** — make schema changes in `apps/api/prisma/schema.prisma`
2. **Create a migration locally**:
   ```bash
   cd apps/api
   npx prisma migrate dev --name describe_your_change
   ```
3. **Commit** the migration file (`prisma/migrations/...`) to source control
4. **Deploy to production** — apply pending migrations using the direct DB connection:
   ```bash
   DATABASE_URL="<neon-direct-url>" npm run migrate:prod
   ```
5. **Then deploy the new API code** to Render (redeploy the service)

### Root-level convenience script

```bash
# From monorepo root — runs prisma migrate deploy in the API workspace
DATABASE_URL="<neon-direct-url>" npm run migrate:prod
```

---

## 6. Deployment checklist

### Before first deployment

- [ ] Neon project created, pooled + direct connection strings saved
- [ ] `DATABASE_URL` (pooled) set in Render
- [ ] `JWT_SECRET` generated (≥ 32 chars) and set in Render
- [ ] `CORS_ALLOWED_ORIGINS` set to your Vercel domain
- [ ] `WEB_BASE_URL` set to your Vercel domain
- [ ] SMTP credentials configured (or accepted that auth emails go to logs only)
- [ ] Initial migration run against Neon using direct connection string
- [ ] `VITE_API_BASE_URL` set in Vercel to your Render API URL

### Every deployment

- [ ] Run migrations **before** deploying new API code if schema changed
- [ ] Verify `/api/health` returns `{"status":"ok"}` after deploy
- [ ] Verify `/api/ready` returns `{"status":"ready","database":"ok"}`
- [ ] Smoke test: login with demo credentials, navigate main pages
- [ ] Check Render logs for startup errors

---

## 7. Rollback

### API rollback

Render keeps previous deploys available. To roll back:

1. Go to Render → your Web Service → **Deploys**
2. Find the last working deploy and click **Redeploy**

> If a migration was applied and you need to roll back the code, the migration stays applied — migrations are forward-only. Write a new migration to undo schema changes if needed.

### Frontend rollback

Vercel keeps all previous deployments available:

1. Go to Vercel → your project → **Deployments**
2. Find the last working deployment and click the three-dot menu → **Promote to Production**

---

## 8. Build commands reference

| Command | Description |
|---------|-------------|
| `npm run build` | Build shared + API + web (full monorepo build) |
| `npm run build:api` | Build API only (`prisma generate` + `tsc`) |
| `npm run build:web` | Build web only (`tsc` + `vite build`) |
| `npm run start:api` | Start compiled API (`node dist/index.js`) |
| `npm run prisma:generate` | Run `prisma generate` in the API workspace |
| `npm run migrate:prod` | Run `prisma migrate deploy` (production-safe only) |

---

## 9. Local production simulation

To test the production build locally before deploying:

```bash
# 1. Build everything
npm run build

# 2. Start the API in production mode
NODE_ENV=production \
  DATABASE_URL="..." \
  JWT_SECRET="..." \
  CORS_ALLOWED_ORIGINS="http://localhost:4173" \
  npm run start:api

# 3. Preview the web build
cd apps/web && npx vite preview --port 4173
```

The Vite preview server serves the compiled `dist/` and routes all paths to `index.html`.
