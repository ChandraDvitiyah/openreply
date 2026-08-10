import { createClient, type Client } from "@libsql/client";
import { randomUUID } from "node:crypto";

export type BioProfile = {
  ownerId: string;
  slug: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  theme: string;
};

export type BioLink = {
  id: string;
  ownerId: string;
  title: string;
  url: string;
  icon: string;
  position: number;
  enabled: boolean;
  smartAppLink: boolean;
  iosUrl: string | null;
  androidUrl: string | null;
};

let client: Client | null = null;
let initialized: Promise<void> | null = null;

function getClient() {
  if (client) return client;
  client = createClient({
    // Link Studio and the automation engine intentionally share one Turso DB.
    url: process.env.TURSO_DATABASE_URL ?? "file:./data/kult.db",
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
  return client;
}

async function ensureSchema() {
  if (initialized) return initialized;
  initialized = (async () => {
    const db = getClient();
    await db.batch(
      [
        `CREATE TABLE IF NOT EXISTS bio_profiles (
          owner_id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          bio TEXT NOT NULL DEFAULT '',
          avatar_url TEXT,
          theme TEXT NOT NULL DEFAULT 'ember',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS bio_links (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          title TEXT NOT NULL,
          url TEXT NOT NULL,
          icon TEXT NOT NULL DEFAULT 'link',
          position INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          smart_app_link INTEGER NOT NULL DEFAULT 0,
          ios_url TEXT,
          android_url TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(owner_id) REFERENCES bio_profiles(owner_id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS bio_link_clicks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          link_id TEXT NOT NULL,
          user_agent TEXT,
          referrer TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(link_id) REFERENCES bio_links(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS bio_profile_views (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL,
          visitor_hash TEXT,
          user_agent TEXT,
          referrer TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(owner_id) REFERENCES bio_profiles(owner_id) ON DELETE CASCADE
        )`,
        "CREATE INDEX IF NOT EXISTS idx_bio_links_owner_position ON bio_links(owner_id, position)",
        "CREATE INDEX IF NOT EXISTS idx_bio_clicks_link_created ON bio_link_clicks(link_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_bio_clicks_created ON bio_link_clicks(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_bio_profile_views_owner_created ON bio_profile_views(owner_id, created_at)",
      ],
      "write"
    );
  })();
  return initialized;
}

function cleanSlug(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
}

function profileFromRow(row: Record<string, unknown>): BioProfile {
  return {
    ownerId: String(row.owner_id),
    slug: String(row.slug),
    displayName: String(row.display_name),
    bio: String(row.bio ?? ""),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    theme: String(row.theme ?? "ember"),
  };
}

function linkFromRow(row: Record<string, unknown>): BioLink {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    title: String(row.title),
    url: String(row.url),
    icon: String(row.icon ?? "link"),
    position: Number(row.position ?? 0),
    enabled: Number(row.enabled) === 1,
    smartAppLink: Number(row.smart_app_link) === 1,
    iosUrl: row.ios_url ? String(row.ios_url) : null,
    androidUrl: row.android_url ? String(row.android_url) : null,
  };
}

export async function ensureBioProfile(
  ownerId: string,
  defaults: { displayName?: string | null; email?: string | null; avatarUrl?: string | null }
) {
  await ensureSchema();
  const existing = await getClient().execute({
    sql: "SELECT * FROM bio_profiles WHERE owner_id = ? LIMIT 1",
    args: [ownerId],
  });
  if (existing.rows[0]) return profileFromRow(existing.rows[0] as Record<string, unknown>);

  const base = cleanSlug(defaults.displayName || defaults.email?.split("@")[0] || "creator") || "creator";
  let slug = base;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const conflict = await getClient().execute({
      sql: "SELECT 1 FROM bio_profiles WHERE slug = ? LIMIT 1",
      args: [slug],
    });
    if (!conflict.rows[0]) break;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }

  await getClient().execute({
    sql: `INSERT INTO bio_profiles (owner_id, slug, display_name, bio, avatar_url)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      ownerId,
      slug,
      defaults.displayName || base,
      "Apps, ideas, and everything I am building.",
      defaults.avatarUrl ?? null,
    ],
  });
  return (await getBioProfileByOwner(ownerId))!;
}

export async function getBioProfileByOwner(ownerId: string) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "SELECT * FROM bio_profiles WHERE owner_id = ? LIMIT 1",
    args: [ownerId],
  });
  return result.rows[0] ? profileFromRow(result.rows[0] as Record<string, unknown>) : null;
}

export async function getPublicBio(slug: string) {
  await ensureSchema();
  const profileResult = await getClient().execute({
    sql: "SELECT * FROM bio_profiles WHERE slug = ? LIMIT 1",
    args: [slug],
  });
  if (!profileResult.rows[0]) return null;
  const profile = profileFromRow(profileResult.rows[0] as Record<string, unknown>);
  const linksResult = await getClient().execute({
    sql: "SELECT * FROM bio_links WHERE owner_id = ? AND enabled = 1 ORDER BY position ASC, created_at ASC",
    args: [profile.ownerId],
  });
  return {
    profile,
    links: linksResult.rows.map((row) => linkFromRow(row as Record<string, unknown>)),
  };
}

export async function listBioLinks(ownerId: string) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `SELECT l.*, COUNT(c.id) AS click_count
          FROM bio_links l
          LEFT JOIN bio_link_clicks c ON c.link_id = l.id
          WHERE l.owner_id = ?
          GROUP BY l.id
          ORDER BY l.position ASC, l.created_at ASC`,
    args: [ownerId],
  });
  return result.rows.map((row) => ({
    ...linkFromRow(row as Record<string, unknown>),
    clickCount: Number(row.click_count ?? 0),
  }));
}

export async function updateBioProfile(
  ownerId: string,
  input: Pick<BioProfile, "slug" | "displayName" | "bio" | "avatarUrl" | "theme">
) {
  await ensureSchema();
  const slug = cleanSlug(input.slug);
  if (slug.length < 2) throw new Error("Choose a slug with at least 2 letters or numbers.");
  await getClient().execute({
    sql: `UPDATE bio_profiles
          SET slug = ?, display_name = ?, bio = ?, avatar_url = ?, theme = ?, updated_at = CURRENT_TIMESTAMP
          WHERE owner_id = ?`,
    args: [slug, input.displayName.trim(), input.bio.trim(), input.avatarUrl || null, input.theme, ownerId],
  });
  return getBioProfileByOwner(ownerId);
}

export async function createBioLink(
  ownerId: string,
  input: Pick<BioLink, "title" | "url" | "icon" | "smartAppLink" | "iosUrl" | "androidUrl">
) {
  await ensureSchema();
  const positionResult = await getClient().execute({
    sql: "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM bio_links WHERE owner_id = ?",
    args: [ownerId],
  });
  const id = randomUUID();
  await getClient().execute({
    sql: `INSERT INTO bio_links
      (id, owner_id, title, url, icon, position, enabled, smart_app_link, ios_url, android_url)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    args: [
      id,
      ownerId,
      input.title.trim(),
      input.url,
      input.icon || "link",
      Number(positionResult.rows[0]?.next_position ?? 0),
      input.smartAppLink ? 1 : 0,
      input.iosUrl || null,
      input.androidUrl || null,
    ],
  });
  return id;
}

export async function updateBioLink(ownerId: string, id: string, input: Partial<BioLink>) {
  await ensureSchema();
  const current = await getClient().execute({
    sql: "SELECT * FROM bio_links WHERE id = ? AND owner_id = ? LIMIT 1",
    args: [id, ownerId],
  });
  if (!current.rows[0]) return false;
  const link = { ...linkFromRow(current.rows[0] as Record<string, unknown>), ...input };
  await getClient().execute({
    sql: `UPDATE bio_links SET title = ?, url = ?, icon = ?, position = ?, enabled = ?,
          smart_app_link = ?, ios_url = ?, android_url = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND owner_id = ?`,
    args: [
      link.title,
      link.url,
      link.icon,
      link.position,
      link.enabled ? 1 : 0,
      link.smartAppLink ? 1 : 0,
      link.iosUrl || null,
      link.androidUrl || null,
      id,
      ownerId,
    ],
  });
  return true;
}

export async function deleteBioLink(ownerId: string, id: string) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "DELETE FROM bio_links WHERE id = ? AND owner_id = ?",
    args: [id, ownerId],
  });
  return result.rowsAffected > 0;
}

export async function getBioLink(id: string) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "SELECT * FROM bio_links WHERE id = ? AND enabled = 1 LIMIT 1",
    args: [id],
  });
  return result.rows[0] ? linkFromRow(result.rows[0] as Record<string, unknown>) : null;
}

export async function recordBioLinkClick(id: string, userAgent: string, referrer: string) {
  await ensureSchema();
  await getClient().execute({
    sql: "INSERT INTO bio_link_clicks (link_id, user_agent, referrer) VALUES (?, ?, ?)",
    args: [id, userAgent.slice(0, 500), referrer.slice(0, 500)],
  });
}

export async function recordBioProfileView(
  ownerId: string,
  input: { visitorHash?: string | null; userAgent?: string | null; referrer?: string | null }
) {
  await ensureSchema();
  await getClient().execute({
    sql: `INSERT INTO bio_profile_views
          (owner_id, visitor_hash, user_agent, referrer)
          VALUES (?, ?, ?, ?)`,
    args: [
      ownerId,
      input.visitorHash ?? null,
      input.userAgent?.slice(0, 500) ?? null,
      input.referrer?.slice(0, 500) ?? null,
    ],
  });
}

function sqliteTimestamp(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export type BioPerformance = {
  pageViews: number;
  uniqueVisitors: number;
  linkClicks: number;
  topLinks: Array<{ id: string; title: string; clicks: number }>;
  daily: Array<{ date: string; views: number; clicks: number }>;
};

export async function getBioPerformance(
  ownerIds: string[],
  since: Date
): Promise<BioPerformance> {
  await ensureSchema();
  if (ownerIds.length === 0) {
    return { pageViews: 0, uniqueVisitors: 0, linkClicks: 0, topLinks: [], daily: [] };
  }

  const placeholders = ownerIds.map(() => "?").join(",");
  const sinceText = sqliteTimestamp(since);
  const db = getClient();
  const [viewTotals, clickTotals, topLinks, dailyViews, dailyClicks] =
    await Promise.all([
      db.execute({
        sql: `SELECT COUNT(*) AS page_views,
                     COUNT(DISTINCT visitor_hash) AS unique_visitors
              FROM bio_profile_views
              WHERE owner_id IN (${placeholders}) AND created_at >= ?`,
        args: [...ownerIds, sinceText],
      }),
      db.execute({
        sql: `SELECT COUNT(*) AS link_clicks
              FROM bio_link_clicks c
              JOIN bio_links l ON l.id = c.link_id
              WHERE l.owner_id IN (${placeholders}) AND c.created_at >= ?`,
        args: [...ownerIds, sinceText],
      }),
      db.execute({
        sql: `SELECT l.id, l.title, COUNT(c.id) AS clicks
              FROM bio_links l
              LEFT JOIN bio_link_clicks c
                ON c.link_id = l.id AND c.created_at >= ?
              WHERE l.owner_id IN (${placeholders})
              GROUP BY l.id, l.title
              ORDER BY clicks DESC, l.position ASC
              LIMIT 5`,
        args: [sinceText, ...ownerIds],
      }),
      db.execute({
        sql: `SELECT DATE(created_at) AS date, COUNT(*) AS count
              FROM bio_profile_views
              WHERE owner_id IN (${placeholders}) AND created_at >= ?
              GROUP BY DATE(created_at)`,
        args: [...ownerIds, sinceText],
      }),
      db.execute({
        sql: `SELECT DATE(c.created_at) AS date, COUNT(*) AS count
              FROM bio_link_clicks c
              JOIN bio_links l ON l.id = c.link_id
              WHERE l.owner_id IN (${placeholders}) AND c.created_at >= ?
              GROUP BY DATE(c.created_at)`,
        args: [...ownerIds, sinceText],
      }),
    ]);

  const daily = new Map<string, { date: string; views: number; clicks: number }>();
  for (const row of dailyViews.rows) {
    const date = String(row.date);
    daily.set(date, { date, views: Number(row.count ?? 0), clicks: 0 });
  }
  for (const row of dailyClicks.rows) {
    const date = String(row.date);
    const item = daily.get(date) ?? { date, views: 0, clicks: 0 };
    item.clicks = Number(row.count ?? 0);
    daily.set(date, item);
  }

  return {
    pageViews: Number(viewTotals.rows[0]?.page_views ?? 0),
    uniqueVisitors: Number(viewTotals.rows[0]?.unique_visitors ?? 0),
    linkClicks: Number(clickTotals.rows[0]?.link_clicks ?? 0),
    topLinks: topLinks.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      clicks: Number(row.clicks ?? 0),
    })),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
