import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/app/generated/prisma/client";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { asStringArray } from "@/lib/utils/string-list";

let directory: string;
let prisma: PrismaClient;

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "kult-turso-test-"));
  const url = `file:${path.join(directory, "kult.db")}`;
  const rawClient = createClient({ url });
  const migrationsRoot = path.join(process.cwd(), "prisma", "turso-migrations");
  const migrations = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of migrations) {
    const migration = await readFile(
      path.join(migrationsRoot, name, "migration.sql"),
      "utf8"
    );
    await rawClient.executeMultiple(migration);
  }
  rawClient.close();

  prisma = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
});

afterAll(async () => {
  await prisma.$disconnect();
  await rm(directory, { recursive: true, force: true });
});

describe("Turso Prisma adapter", () => {
  it("persists an automation with JSON-backed string lists", async () => {
    const user = await prisma.user.create({
      data: { id: "clerk_test_user", email: "owner@example.com" },
    });
    const workspace = await prisma.workspace.create({
      data: { name: "Kult", ownerId: user.id },
    });
    const account = await prisma.instagramAccount.create({
      data: {
        workspaceId: workspace.id,
        instagramId: "instagram_1",
        username: "kult_test",
        accessToken: "encrypted",
      },
    });
    const automation = await prisma.automation.create({
      data: {
        workspaceId: workspace.id,
        instagramAccountId: account.id,
        name: "Future reels",
        keywords: ["LINK", "APP"],
        dmMessage: "Here is the link",
        dmMessages: ["Here is the link", "Sent!"],
        publicReplyMessages: ["Check your DMs"],
        autoAddNewReels: true,
      },
    });

    expect(asStringArray(automation.keywords)).toEqual(["LINK", "APP"]);
    expect(asStringArray(automation.dmMessages)).toEqual([
      "Here is the link",
      "Sent!",
    ]);
    expect(asStringArray(automation.publicReplyMessages)).toEqual([
      "Check your DMs",
    ]);
  });

  it("persists durable jobs, hourly counters, and worker state", async () => {
    const job = await prisma.durableJob.create({
      data: {
        name: "process-comment",
        payload: { commentId: "comment_1" },
        dedupeKey: "comment_account_1_comment_1",
      },
    });
    expect(job.status).toBe("WAITING");

    const windowStart = new Date("2026-08-14T01:00:00.000Z");
    const rateRows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `INSERT INTO "DmRateLimitBucket"
         ("instagramAccountId", "windowStart", "count", "updatedAt")
       VALUES (?, ?, 1, ?)
       ON CONFLICT ("instagramAccountId", "windowStart") DO UPDATE SET
         "count" = "DmRateLimitBucket"."count" + 1,
         "updatedAt" = excluded."updatedAt"
       WHERE "DmRateLimitBucket"."count" < ?
       RETURNING "count"`,
      "account_1",
      windowStart,
      new Date(),
      750
    );
    expect(rateRows[0].count).toBe(1);
    await prisma.workerState.create({
      data: {
        key: "dm",
        status: "running",
        pid: 123,
        checkedAt: new Date(),
      },
    });

    await expect(prisma.durableJob.count()).resolves.toBe(1);
    await expect(prisma.dmRateLimitBucket.count()).resolves.toBe(1);
    await expect(prisma.workerState.count()).resolves.toBe(1);
  });
});
