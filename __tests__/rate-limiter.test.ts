/** Database-backed hourly DM rate limiter tests. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockDeleteMany, mockQueryRawUnsafe } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockDeleteMany: vi.fn(),
  mockQueryRawUnsafe: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    dmRateLimitBucket: {
      findUnique: mockFindUnique,
      deleteMany: mockDeleteMany,
    },
    $queryRawUnsafe: mockQueryRawUnsafe,
  },
}));

import {
  RATE_LIMIT_MAX,
  checkRateLimit,
  incrementDMCounter,
  reserveDMSlot,
  resetRateLimit,
} from "../lib/utils/rate-limiter";

beforeEach(() => vi.clearAllMocks());

describe("checkRateLimit", () => {
  it("allows when count is below the cap", async () => {
    mockFindUnique.mockResolvedValue({ count: 50 });
    const result = await checkRateLimit("account_123");
    expect(result).toMatchObject({
      allowed: true,
      currentCount: 50,
      remainingDMs: RATE_LIMIT_MAX - 50,
      reserved: false,
    });
  });

  it("denies at the cap and eventually skips", async () => {
    mockFindUnique.mockResolvedValue({ count: RATE_LIMIT_MAX });
    await expect(checkRateLimit("account_123")).resolves.toMatchObject({
      allowed: false,
      shouldRequeue: true,
      shouldSkip: false,
    });
    await expect(checkRateLimit("account_123", 3)).resolves.toMatchObject({
      allowed: false,
      shouldRequeue: false,
      shouldSkip: true,
    });
  });
});

describe("reserveDMSlot", () => {
  it("atomically reserves a row below the cap", async () => {
    mockQueryRawUnsafe.mockResolvedValue([{ count: 51 }]);
    const result = await reserveDMSlot("account_123");
    expect(mockQueryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT"),
      "account_123",
      expect.any(Date),
      expect.any(Date),
      RATE_LIMIT_MAX
    );
    expect(result).toMatchObject({
      allowed: true,
      reserved: true,
      currentCount: 51,
      remainingDMs: RATE_LIMIT_MAX - 51,
    });
  });

  it("requeues when the conditional update cannot reserve", async () => {
    mockQueryRawUnsafe.mockResolvedValue([]);
    mockFindUnique.mockResolvedValue({ count: RATE_LIMIT_MAX });
    await expect(reserveDMSlot("account_123")).resolves.toMatchObject({
      allowed: false,
      reserved: false,
      shouldRequeue: true,
    });
  });

  it("supports the compatibility increment and reset helpers", async () => {
    mockQueryRawUnsafe.mockResolvedValue([{ count: BigInt(12) }]);
    await expect(incrementDMCounter("account_123")).resolves.toBe(12);
    await resetRateLimit("account_123");
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { instagramAccountId: "account_123" },
    });
  });
});
