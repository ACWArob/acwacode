import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { rankProvidersByMetric, usageDriverLabel } from "./usageProviders";

describe("usageDriverLabel", () => {
  it("names Antigravity limits Gemini, apart from Codex, and falls back for drivers without usage", () => {
    expect(usageDriverLabel(ProviderDriverKind.make("antigravity"))).toBe("Gemini");
    expect(usageDriverLabel(ProviderDriverKind.make("codex"))).toBe("Codex");
    expect(usageDriverLabel(ProviderDriverKind.make("claudeAgent"))).toBe("Claude Code");
    expect(usageDriverLabel(ProviderDriverKind.make("not-a-driver"))).toBe("not-a-driver");
  });
});

describe("rankProvidersByMetric", () => {
  it("ranks by the selected metric, highest first", () => {
    const totals = [
      { provider: "codex" as const, totalTokens: 100, costUsd: 20 },
      { provider: "claude" as const, totalTokens: 200, costUsd: 10 },
    ];
    const providers = ["codex", "claude"] as const;

    expect(rankProvidersByMetric(providers, totals, "tokens")).toEqual(["claude", "codex"]);
    expect(rankProvidersByMetric(providers, totals, "cost")).toEqual(["codex", "claude"]);
  });

  it("keeps ties in input order without reordering the shared provider list", () => {
    const totals = [
      { provider: "codex" as const, totalTokens: 10, costUsd: 1 },
      { provider: "claude" as const, totalTokens: 10, costUsd: 1 },
      { provider: "grok" as const, totalTokens: 20, costUsd: 2 },
    ];
    const providers = ["claude", "codex", "grok"] as const;

    expect(rankProvidersByMetric(providers, totals, "tokens")).toEqual(["grok", "claude", "codex"]);
    expect(providers).toEqual(["claude", "codex", "grok"]);
  });
});
