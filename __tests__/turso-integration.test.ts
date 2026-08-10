import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/app/generated/prisma/client";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { asStringArray } from "@/lib/utils/string-list";

let directory: string;
let prisma: PrismaClient;

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "kult-turso-test-"));
  const url = `file:${path.join(directory, "kult.db")}`;
  const migration = await readFile(
    path.join(
      process.cwd(),
      "prisma",
      "turso-migrations",
      "20260804193000_turso_baseline",
      "migration.sql"
    ),
    "utf8"
  );
  const rawClient = createClient({ url });
  await rawClient.executeMultiple(migration);
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
});
