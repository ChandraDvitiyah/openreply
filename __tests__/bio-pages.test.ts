import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";

let directory: string;
let bio: typeof import("@/lib/bio-db");
let previousUrl: string | undefined;
let previousToken: string | undefined;

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "kult-bio-pages-"));
  previousUrl = process.env.TURSO_DATABASE_URL;
  previousToken = process.env.TURSO_AUTH_TOKEN;
  process.env.TURSO_DATABASE_URL = `file:${path.join(directory, "bio.db")}`;
  delete process.env.TURSO_AUTH_TOKEN;
  vi.resetModules();
  bio = await import("@/lib/bio-db");
  await bio.ensureBioProfile("alice", { displayName: "Alice" });
  await bio.ensureBioProfile("bob", { displayName: "Bob" });
});
afterAll(async () => {
  if (previousUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = previousUrl;
  if (previousToken === undefined) delete process.env.TURSO_AUTH_TOKEN;
  else process.env.TURSO_AUTH_TOKEN = previousToken;
  await rm(directory, { recursive: true, force: true });
});

const destination = { title: "Store", url: "https://example.com", icon: "link", smartAppLink: false, iosUrl: null, androidUrl: null };

describe("multiple Link Studio pages", () => {
  it("preserves the original page and keeps each page's links separate", async () => {
    const originalId = await bio.createBioLink("alice", destination);
    const page = await bio.createBioPage("alice", { displayName: "Alice Apps", slug: "alice-apps" });
    const appId = await bio.createBioLink("alice", { ...destination, title: "App" }, page.ownerId);
    expect((await bio.listBioProfiles("alice")).map(p => p.slug)).toEqual(expect.arrayContaining(["alice", "alice-apps"]));
    expect((await bio.listBioLinks("alice")).map(l => l.id)).toEqual([originalId]);
    expect((await bio.getPublicBio("alice-apps"))?.links.map(l => l.id)).toEqual([appId]);
    expect(await bio.getOwnedBioProfile("bob", page.ownerId)).toBeNull();
    await expect(bio.createBioLink("bob", destination, page.ownerId)).rejects.toThrow("Page not found");
    await expect(bio.updateBioProfile("bob", page, page.ownerId)).rejects.toThrow("Page not found");
    expect(await bio.updateBioLink("bob", appId, { enabled: false })).toBe(false);
    expect(await bio.deleteBioLink("bob", appId)).toBe(false);
    expect(await bio.updateBioLink("alice", appId, { enabled: false })).toBe(true);
    expect((await bio.getPublicBio("alice-apps"))?.links).toEqual([]);
    expect(await bio.updateBioLink("alice", appId, { enabled: true })).toBe(true);
    await bio.recordBioLinkClick(appId, "test", "");
    await bio.recordBioProfileView(page.ownerId, { visitorHash: "visitor" });
    const performance = await bio.getBioPerformance(["alice"], new Date(0));
    expect(performance).toMatchObject({ pageViews: 1, uniqueVisitors: 1, linkClicks: 1 });
    expect((await bio.getBioPerformance(["bob"], new Date(0))).pageViews).toBe(0);
    await bio.updateBioProfile("alice", { ...page, slug: "alice-apps-new" }, page.ownerId);
    expect(await bio.getPublicBio("alice-apps")).toBeNull();
    expect((await bio.getPublicBio("alice-apps-new"))?.links[0].id).toBe(appId);
  });

  it("rejects duplicate URLs atomically without adding an orphan page", async () => {
    const before = await bio.listBioProfiles("bob");
    await expect(bio.createBioPage("bob", { displayName: "Taken", slug: "alice" })).rejects.toThrow();
    expect(await bio.listBioProfiles("bob")).toEqual(before);
    const client = createClient({ url: `file:${path.join(directory, "bio.db")}` });
    const rows = await client.execute("SELECT COUNT(*) AS count FROM bio_profiles WHERE display_name = 'Taken'");
    expect(rows.rows[0].count).toBe(0);
    client.close();
  });
});
