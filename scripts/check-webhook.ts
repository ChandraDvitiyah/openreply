import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;

  if (!appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is required");
  }
  if (!verifyToken) {
    throw new Error("WEBHOOK_VERIFY_TOKEN is required");
  }

  const challenge = "kult-webhook-check";
  const url = new URL("/api/webhook", appUrl);
  url.searchParams.set("hub.mode", "subscribe");
  url.searchParams.set("hub.verify_token", verifyToken);
  url.searchParams.set("hub.challenge", challenge);

  const response = await fetch(url, {
    headers: { "ngrok-skip-browser-warning": "1" },
  });
  const body = await response.text();

  if (!response.ok || body !== challenge) {
    throw new Error(
      `Webhook check failed with HTTP ${response.status} and response ${JSON.stringify(body.slice(0, 200))}`
    );
  }

  console.log("Webhook verification succeeded through the public tunnel.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
