import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type MaintenanceTask = "reels" | "tokens";

const taskPaths: Record<MaintenanceTask, string> = {
  reels: "/api/cron/attach-next-reel",
  tokens: "/api/cron/refresh-tokens",
};

function readTask(value: string | undefined): MaintenanceTask {
  if (value === "reels" || value === "tokens") return value;
  throw new Error("Expected maintenance task: reels or tokens");
}

async function main() {
  const task = readTask(process.argv[2]);
  const cronSecret = process.env.CRON_SECRET;
  const baseUrl =
    process.env.MAINTENANCE_BASE_URL ?? "http://127.0.0.1:3000";

  if (!cronSecret) throw new Error("CRON_SECRET is required");

  const response = await fetch(new URL(taskPaths[task], baseUrl), {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `${task} maintenance failed with HTTP ${response.status}: ${body.slice(0, 500)}`
    );
  }

  console.log(`${task} maintenance completed successfully.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
