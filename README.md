# ShelfSense

ShelfSense is a smart inventory, stock movement, expiry, purchasing, and branch management SaaS for small businesses. It is organized as an npm workspace with a React/Vite frontend, an Express API, shared TypeScript types, and Prisma-backed PostgreSQL data storage.

## Tech Stack

- Frontend: React, Vite, TypeScript, React Router
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL, Prisma, Neon-compatible connection strings
- Auth and security: JWT, bcrypt, role-based access control
- Workspace tooling: npm workspaces

## Folder Structure

```text
shelfsense/
  apps/
    api/          Express API, Prisma schema, migrations, seed data
    web/          React + Vite frontend
  packages/
    shared/       Shared TypeScript types
  docs/           Project documentation and readiness notes
```

## Prerequisites

- Node.js and npm
- PostgreSQL database, or a Neon project
- Git

## Environment Setup

Environment files are not committed. Start by copying the example files, then fill in values for your machine or deployment.

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env
```

### `apps/api/.env`

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
JWT_SECRET="replace-with-a-long-random-secret"
PORT=4000
NODE_ENV=development
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5000,http://127.0.0.1:5000
```

- `DATABASE_URL`: PostgreSQL connection string used by Prisma and the API.
- `JWT_SECRET`: Secret used to sign login tokens. Use a long random value outside local development.
- `PORT`: API server port. Local development expects `4000`.
- `NODE_ENV`: Runtime environment, usually `development` locally and `production` in deployment.
- `CORS_ALLOWED_ORIGINS`: Comma-separated browser origins allowed to call the API. Requests without an `Origin` header, such as curl or server-to-server calls, are allowed.

### `apps/web/.env`

```env
VITE_API_BASE_URL=/api
```

- `VITE_API_BASE_URL`: API base URL used by the frontend. For local Vite development, `/api` keeps requests compatible with the Vite proxy. In production, set this to the deployed API origin or same-origin API path used by your hosting setup.

## Environment Separation

Use separate environment files and separate backing services for local development and production.

Local development:

- Start from `apps/api/.env.development.example` and copy it to `apps/api/.env`.
- Start from `apps/web/.env.development.example` and copy it to `apps/web/.env`.
- Use a local database or a dedicated development Neon database.
- Keep `VITE_API_BASE_URL=/api` so Vite can proxy frontend requests to the local API.

Production:

- Use `apps/api/.env.production.example` and `apps/web/.env.production.example` as deployment checklists, not as committed secret files.
- Use a separate production Neon database.
- Set `NODE_ENV=production`.
- Set `CORS_ALLOWED_ORIGINS` to the deployed web app URL exactly.
- Set `VITE_API_BASE_URL` to the deployed API origin or same-origin API path.

Never reuse these values in production:

- Development or local `DATABASE_URL`.
- Development `JWT_SECRET`.
- Localhost-only `CORS_ALLOWED_ORIGINS`.
- Any real `.env` file contents from a developer machine.

## Install Dependencies

```bash
npm install
```

## Database Migration

Run migrations against the database in `apps/api/.env`.

```bash
npm run db:migrate --workspace @shelfsense/api
```

If the Prisma client is stale after schema changes, rebuild the API or run:

```bash
npm run db:generate --workspace @shelfsense/api
```

## Seed Demo Data

```bash
npm run db:seed
```

Demo accounts:

- OWNER: `demo@shelfsense.local` / `demo123456`
- OPERATOR: `operator@shelfsense.local` / `demo123456`

## Run Development Servers

Run both the frontend and API:

```bash
npm run dev
```

Or run them separately:

```bash
npm run dev:api
npm run dev:web
```

Local defaults:

- API: `http://127.0.0.1:4000`
- Web: `http://127.0.0.1:5000`

## Build Project

```bash
npm run build
```

The root build compiles shared types, the API, and the web app.

## PWA Support

The web app includes a lightweight Progressive Web App foundation:

- `apps/web/public/manifest.webmanifest` defines the ShelfSense install metadata, standalone display mode, start URL, theme color, and install icons.
- `apps/web/public/sw.js` caches the app shell and static same-origin assets for quicker repeat loads and basic offline access.
- API routes are handled network-only by the service worker, so authenticated inventory data is not cached aggressively.
- When the browser is offline, the authenticated app shell shows a friendly offline notice. API connection failures also surface a clearer server/offline message.

For production deployments, serve the web app over HTTPS and make sure all frontend routes fall back to `index.html` so installed PWA navigation works after refreshes.

## Common Commands

```bash
npm install
npm run dev
npm run dev:api
npm run dev:web
npm run build
npm run db:migrate --workspace @shelfsense/api
npm run db:seed
```

## Troubleshooting

### Prisma migration pending or database drift

Run:

```bash
npm run db:migrate --workspace @shelfsense/api
```

If Prisma reports drift, confirm you are pointed at the intended database before resetting or applying destructive changes. For shared or production-like databases, create a backup first and prefer a reviewed migration path.

### Vite proxy `ECONNREFUSED`

Make sure the API is running and listening on port `4000`:

```bash
npm run dev:api
```

For local development, keep `VITE_API_BASE_URL=/api` and ensure the Vite proxy target is `http://127.0.0.1:4000`. Using `127.0.0.1` avoids some IPv6 `localhost` resolution issues on Windows.

### Failed to fetch

Check that:

- The API server is running.
- `apps/web/.env` has the correct `VITE_API_BASE_URL`.
- The browser request path matches either the Vite proxy path in development or the deployed API URL in production.
- CORS and hosting routes are configured correctly for the deployed frontend/API pair.
- The deployed frontend origin is included in `CORS_ALLOWED_ORIGINS`.

### Internal server error after schema change

Run migrations and regenerate Prisma client:

```bash
npm run db:migrate --workspace @shelfsense/api
npm run db:generate --workspace @shelfsense/api
```

Then restart the API server. Existing rows may also need safe defaults when new required fields are introduced.

### Neon connection string tips

- Use the pooled or direct connection string recommended for your environment.
- Include `?sslmode=require` when Neon provides it or your deployment requires TLS.
- Keep the connection string in `apps/api/.env` locally and in your deployment secret manager in production.
- Do not commit real Neon credentials.
