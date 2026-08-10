import { createClient } from "@libsql/client";
import { loadEnvConfig } from "@next/env";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

loadEnvConfig(process.cwd());

async function main() {
  const databaseUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (
    !databaseUrl ||
    (!databaseUrl.startsWith("libsql://") && !databaseUrl.startsWith("file:"))
  ) {
    throw new Error("TURSO_DATABASE_URL must begin with libsql:// or file:");
  }
  if (databaseUrl.startsWith("libsql://") && !authToken) {
    throw new Error("TURSO_AUTH_TOKEN is required");
  }

  const client = createClient({
    url: databaseUrl,
    authToken: authToken || undefined,
  });
  const migrationsRoot = path.join(
    process.cwd(),
    "prisma",
    "turso-migrations"
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS _kult_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const entries = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const name of entries) {
    const applied = await client.execute({
      sql: "SELECT 1 FROM _kult_migrations WHERE name = ? LIMIT 1",
      args: [name],
    });
    if (applied.rows.length > 0) {
      console.log(`skip ${name}`);
      continue;
    }

    const sql = await readFile(
      path.join(migrationsRoot, name, "migration.sql"),
      "utf8"
    );
    const transaction = await client.transaction("write");
    try {
      await transaction.executeMultiple(sql);
      await transaction.execute({
        sql: "INSERT INTO _kult_migrations (name) VALUES (?)",
        args: [name],
      });
      await transaction.commit();
      console.log(`applied ${name}`);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  client.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
