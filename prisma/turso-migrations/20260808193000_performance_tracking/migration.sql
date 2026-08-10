CREATE TABLE "SocialPerformanceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "accountInternalId" TEXT NOT NULL,
    "accountExternalId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "periodDays" INTEGER NOT NULL DEFAULT 30,
    "capturedDate" TEXT NOT NULL,
    "contentCount" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "saves" INTEGER,
    "shares" INTEGER,
    "interactions" INTEGER,
    "insightsAvailable" INTEGER NOT NULL DEFAULT 0,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SocialPerformanceSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SocialPerformanceSnapshot_platform_accountInternalId_periodDays_capturedDate_key"
ON "SocialPerformanceSnapshot"("platform", "accountInternalId", "periodDays", "capturedDate");

CREATE INDEX "SocialPerformanceSnapshot_workspaceId_periodDays_capturedAt_idx"
ON "SocialPerformanceSnapshot"("workspaceId", "periodDays", "capturedAt");

CREATE INDEX "SocialPerformanceSnapshot_workspaceId_platform_periodDays_idx"
ON "SocialPerformanceSnapshot"("workspaceId", "platform", "periodDays");

CREATE TABLE IF NOT EXISTS "bio_profiles" (
    "owner_id" TEXT PRIMARY KEY,
    "slug" TEXT NOT NULL UNIQUE,
    "display_name" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "avatar_url" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'ember',
    "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "bio_links" (
    "id" TEXT PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'link',
    "position" INTEGER NOT NULL DEFAULT 0,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "smart_app_link" INTEGER NOT NULL DEFAULT 0,
    "ios_url" TEXT,
    "android_url" TEXT,
    "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("owner_id") REFERENCES "bio_profiles"("owner_id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "bio_link_clicks" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "link_id" TEXT NOT NULL,
    "user_agent" TEXT,
    "referrer" TEXT,
    "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("link_id") REFERENCES "bio_links"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "bio_profile_views" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "owner_id" TEXT NOT NULL,
    "visitor_hash" TEXT,
    "user_agent" TEXT,
    "referrer" TEXT,
    "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("owner_id") REFERENCES "bio_profiles"("owner_id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_bio_profile_views_owner_created"
ON "bio_profile_views"("owner_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_bio_clicks_created"
ON "bio_link_clicks"("created_at");
