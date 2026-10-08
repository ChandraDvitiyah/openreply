ALTER TABLE "ScheduledPost" ADD COLUMN "publishingOptions" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ScheduledPost" ADD COLUMN "preparation" JSONB NOT NULL DEFAULT '{}';
