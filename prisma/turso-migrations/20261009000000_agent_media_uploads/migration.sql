CREATE TABLE "AgentMediaUpload" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "objectId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "expectedSha256" TEXT,
  "parts" TEXT NOT NULL DEFAULT '[]',
  "nextOffset" INTEGER NOT NULL DEFAULT 0,
  "state" TEXT NOT NULL DEFAULT 'OPEN',
  "leaseOwner" TEXT,
  "leaseExpiresAt" DATETIME,
  "mediaUrl" TEXT,
  "sha256" TEXT,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AgentMediaUpload_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AgentMediaUpload_workspaceId_userId_idx" ON "AgentMediaUpload"("workspaceId", "userId");
CREATE INDEX "AgentMediaUpload_expiresAt_idx" ON "AgentMediaUpload"("expiresAt");
