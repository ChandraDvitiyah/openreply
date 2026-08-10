CREATE TABLE "FacebookPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "webhookSubscribed" INTEGER NOT NULL DEFAULT 0,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FacebookPage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FacebookPage_pageId_key" ON "FacebookPage"("pageId");
CREATE INDEX "FacebookPage_workspaceId_idx" ON "FacebookPage"("workspaceId");

CREATE TABLE "FacebookAutomation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "facebookPageId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MESSENGER_AUTORESPONDER',
    "name" TEXT NOT NULL,
    "postId" TEXT,
    "matchAnyPost" INTEGER NOT NULL DEFAULT 1,
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "matchAnyWord" INTEGER NOT NULL DEFAULT 0,
    "replyMessage" TEXT NOT NULL,
    "wholeWordMatch" INTEGER NOT NULL DEFAULT 1,
    "isActive" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FacebookAutomation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FacebookAutomation_facebookPageId_fkey" FOREIGN KEY ("facebookPageId") REFERENCES "FacebookPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "FacebookAutomation_workspaceId_idx" ON "FacebookAutomation"("workspaceId");
CREATE INDEX "FacebookAutomation_facebookPageId_idx" ON "FacebookAutomation"("facebookPageId");
CREATE INDEX "FacebookAutomation_postId_idx" ON "FacebookAutomation"("postId");

CREATE TABLE "FacebookMessageLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "facebookPageId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT,
    "triggerId" TEXT NOT NULL,
    "triggerText" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "matchedKeyword" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FacebookMessageLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FacebookMessageLog_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "FacebookAutomation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FacebookMessageLog_facebookPageId_fkey" FOREIGN KEY ("facebookPageId") REFERENCES "FacebookPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FacebookMessageLog_automationId_triggerId_key" ON "FacebookMessageLog"("automationId", "triggerId");
CREATE INDEX "FacebookMessageLog_workspaceId_idx" ON "FacebookMessageLog"("workspaceId");
CREATE INDEX "FacebookMessageLog_facebookPageId_idx" ON "FacebookMessageLog"("facebookPageId");
CREATE INDEX "FacebookMessageLog_status_idx" ON "FacebookMessageLog"("status");
