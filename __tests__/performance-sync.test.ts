import { describe, expect, it } from "vitest";
import {
  PERFORMANCE_PERIODS,
  normalizePerformancePeriod,
} from "@/lib/performance/social-sync";

describe("performance reporting windows", () => {
  it.each(PERFORMANCE_PERIODS)("accepts the supported %i-day window", (days) => {
    expect(normalizePerformancePeriod(String(days))).toBe(days);
  });

  it.each([null, "", "0", "14", "365", "not-a-number"])(
    "falls back to 30 days for %s",
    (value) => {
      expect(normalizePerformancePeriod(value)).toBe(30);
    }
  );
});
