import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeInstagramAccountToWebhooks } from "@/lib/meta/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Instagram webhook subscription", () => {
  it("subscribes comments, messages, and button postbacks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await subscribeInstagramAccountToWebhooks("ig-account", "access-token");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(options.body))).toEqual({
      subscribed_fields: ["comments", "messages", "messaging_postbacks"],
    });
  });
});
