import { describe, expect, it } from "vite-plus/test";

import { chatGptUsageToSnapshot } from "./CodexChatGptUsage.ts";
import { codexRateLimitsToLimits } from "./codexUsageLimits.ts";

describe("chatGptUsageToSnapshot", () => {
  it("turns ChatGPT's 5-hour and weekly windows into plan windows", () => {
    const snapshot = chatGptUsageToSnapshot({
      plan_type: "plus",
      rate_limit: {
        primary_window: { used_percent: 27, limit_window_seconds: 18000, reset_at: 1782770922 },
        secondary_window: { used_percent: 4, limit_window_seconds: 604800, reset_at: 1783357722 },
      },
    });
    const limits = codexRateLimitsToLimits({ snapshot, checkedAt: "2026-11-24T19:00:00.000Z" });
    expect(limits.windows.map((window) => [window.kind, window.usedPercent])).toEqual([
      ["session", 27],
      ["weekly", 4],
    ]);
  });

  it("has no windows when ChatGPT reports none", () => {
    const snapshot = chatGptUsageToSnapshot({ plan_type: "plus", rate_limit: null });
    expect(
      codexRateLimitsToLimits({ snapshot, checkedAt: "2026-11-24T19:00:00.000Z" }).windows,
    ).toEqual([]);
  });
});
