CREATE TABLE "ScheduledPost" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "createdById" TEXT NOT NULL,
  "clientRequestId" TEXT,
  "platform" TEXT NOT NULL,
  "instagramAccountId" TEXT REFERENCES "InstagramAccount"("id") ON DELETE SET NULL,
  "facebookPageId" TEXT REFERENCES "FacebookPage"("id") ON DELETE SET NULL,
  "accountName" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "caption" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL,
  "mediaUrls" JSONB NOT NULL DEFAULT '[]',
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "scheduledAt" DATETIME,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "processingChecks" INTEGER NOT NULL DEFAULT 0,
  "availableAt" DATETIME,
  "leaseOwner" TEXT,
  "leaseExpiresAt" DATETIME,
  "containerId" TEXT,
  "publishStartedAt" DATETIME,
  "externalPostId" TEXT,
  "publishedAt" DATETIME,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "ScheduledPost_workspaceId_status_scheduledAt_idx" ON "ScheduledPost"("workspaceId", "status", "scheduledAt");
CREATE INDEX "ScheduledPost_status_availableAt_idx" ON "ScheduledPost"("status", "availableAt");
CREATE INDEX "ScheduledPost_status_leaseExpiresAt_idx" ON "ScheduledPost"("status", "leaseExpiresAt");

CREATE UNIQUE INDEX "ScheduledPost_workspaceId_clientRequestId_key" ON "ScheduledPost"("workspaceId", "clientRequestId");
