ALTER TABLE "ScheduledPost" ADD COLUMN "mediaCleanupQueuedAt" DATETIME;
CREATE TABLE "ScheduledMediaCleanup" (
  "url" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseExpiresAt" DATETIME,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "deletedAt" DATETIME,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ScheduledMediaCleanup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ScheduledMediaCleanup_state_availableAt_idx" ON "ScheduledMediaCleanup"("state", "availableAt");
CREATE INDEX "ScheduledMediaCleanup_workspaceId_state_idx" ON "ScheduledMediaCleanup"("workspaceId", "state");
