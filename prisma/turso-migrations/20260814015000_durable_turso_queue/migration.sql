CREATE TABLE "DurableJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "attemptsMade" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" DATETIME,
    "lastError" TEXT,
    "completedAt" DATETIME,
    "failedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "DurableJob_dedupeKey_key" ON "DurableJob"("dedupeKey");
CREATE INDEX "DurableJob_status_availableAt_idx" ON "DurableJob"("status", "availableAt");
CREATE INDEX "DurableJob_status_leaseExpiresAt_idx" ON "DurableJob"("status", "leaseExpiresAt");
CREATE INDEX "DurableJob_completedAt_idx" ON "DurableJob"("completedAt");

CREATE TABLE "DmRateLimitBucket" (
    "instagramAccountId" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("instagramAccountId", "windowStart")
);

CREATE INDEX "DmRateLimitBucket_windowStart_idx" ON "DmRateLimitBucket"("windowStart");

CREATE TABLE "WorkerState" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "hostname" TEXT,
    "startedAt" DATETIME,
    "checkedAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
