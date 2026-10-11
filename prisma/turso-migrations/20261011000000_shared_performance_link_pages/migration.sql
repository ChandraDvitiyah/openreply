-- Null marks older snapshots that need one refresh to collect video details.
ALTER TABLE "SocialPerformanceSnapshot" ADD COLUMN "videoPosts" JSONB;

-- Preserve legacy profile keys, public URLs, link IDs and all analytics.
CREATE TABLE IF NOT EXISTS bio_page_owners (
  profile_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES bio_profiles(owner_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bio_page_owners_user ON bio_page_owners(user_id);
