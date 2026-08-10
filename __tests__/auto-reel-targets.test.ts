import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockGetUserMedia, mockDecryptToken } = vi.hoisted(() => ({
  mockPrisma: {
    automation: { findMany: vi.fn() },
    automationMedia: { createMany: vi.fn() },
  },
  mockGetUserMedia: vi.fn(),
  mockDecryptToken: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/client", () => ({ getUserMedia: mockGetUserMedia }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: mockDecryptToken }));

import { syncAutoReelTargets } from "@/lib/polling/auto-reel-targets";

const campaign = {
  id: "automation_1",
  instagramAccountId: "account_1",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  autoAddReelsSince: new Date("2026-08-02T00:00:00.000Z"),
  instagramAccount: {
    id: "account_1",
    accessToken: "encrypted-token",
  },
  mediaTargets: [{ mediaId: "known_reel" }],
};

describe("syncAutoReelTargets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.automation.findMany.mockResolvedValue([campaign]);
    mockPrisma.automationMedia.createMany.mockResolvedValue({ count: 1 });
    mockDecryptToken.mockReturnValue("access-token");
  });

  it("attaches only unknown reels published after the campaign was enabled", async () => {
    mockGetUserMedia.mockResolvedValue([
      {
        id: "new_reel",
        media_type: "VIDEO",
        media_product_type: "REELS",
        timestamp: "2026-08-03T00:00:00.000Z",
        permalink: "https://instagram.com/reel/new",
      },
      {
        id: "known_reel",
        media_type: "VIDEO",
        media_product_type: "REELS",
        timestamp: "2026-08-03T00:00:00.000Z",
      },
      {
        id: "old_reel",
        media_type: "VIDEO",
        media_product_type: "REELS",
        timestamp: "2026-07-31T00:00:00.000Z",
      },
      {
        id: "new_image",
        media_type: "IMAGE",
        media_product_type: "FEED",
        timestamp: "2026-08-03T00:00:00.000Z",
      },
    ]);

    await expect(syncAutoReelTargets()).resolves.toEqual({
      campaignsChecked: 1,
      reelsAttached: 1,
      failedAccounts: [],
    });
    expect(mockPrisma.automationMedia.createMany).toHaveBeenCalledWith({
      data: [
        {
          automationId: "automation_1",
          mediaId: "new_reel",
          mediaUrl: "https://instagram.com/reel/new",
          publishedAt: new Date("2026-08-03T00:00:00.000Z"),
        },
      ],
    });
  });

  it("isolates an account whose Meta media fetch fails", async () => {
    mockGetUserMedia.mockRejectedValue(new Error("Meta unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(syncAutoReelTargets()).resolves.toEqual({
      campaignsChecked: 1,
      reelsAttached: 0,
      failedAccounts: ["account_1"],
    });
    expect(mockPrisma.automationMedia.createMany).not.toHaveBeenCalled();
  });
});
