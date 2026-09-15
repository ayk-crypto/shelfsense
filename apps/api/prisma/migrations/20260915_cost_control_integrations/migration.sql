CREATE TABLE IF NOT EXISTS "IntegrationCredential" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY['costs:read','items:read']::TEXT[],
  "lastUsedAt" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ,
  "revokedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "IntegrationCredential_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "IntegrationCredential_workspaceId_idx"
  ON "IntegrationCredential"("workspaceId");
CREATE INDEX IF NOT EXISTS "IntegrationCredential_active_idx"
  ON "IntegrationCredential"("workspaceId", "revokedAt", "expiresAt");
