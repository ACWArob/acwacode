import { ProviderDriverKind, ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { VOICE_CALL_HINT } from "~/speech/voiceCall.logic";

import {
  autoRoute,
  claudeLast,
  foldGroupTurns,
  GROUP_TURN_TEXT,
  resolveLastAgentSelection,
  type AutoRoute,
} from "./composerNoteMode";

const claude: ModelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-opus-4-6",
  options: [{ id: "effort", value: "high" }],
};
const codex: ModelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" };
const runs = [
  { ordinal: 2, modelSelection: claude },
  { ordinal: 1, modelSelection: codex },
];
const noRoute: AutoRoute = { topic: null, general: null };
const generalCodex: AutoRoute = { topic: null, general: codex };
const topicCodex: AutoRoute = { topic: { reason: "code", selection: codex }, general: null };

describe("resolveLastAgentSelection", () => {
  it.each<
    [string, Partial<Parameters<typeof resolveLastAgentSelection>[0]>, ModelSelection | null]
  >([
    ["the latest run's agent, with its effort", { runs }, claude],
    ["a clear topic over the last agent", { runs, route: topicCodex }, codex],
    ["the general pick in a channel that never ran an agent", { route: generalCodex }, codex],
    [
      "the general pick when the last agent is gone",
      { runs, isRoutable: () => false, route: generalCodex },
      codex,
    ],
    ["a note with nothing to route to", {}, null],
    ["the picked agent over a clear topic", { runs, route: topicCodex, pick: claude }, claude],
    [
      "the topic when the picked agent is gone",
      { route: topicCodex, pick: claude, isRoutable: (s) => s === codex },
      codex,
    ],
    ["a note while note mode is on, even with a pick", { noteMode: true, pick: claude }, null],
    [
      "a note while note mode is on, whatever the topic",
      { runs, noteMode: true, route: topicCodex },
      null,
    ],
  ])("%s", (_name, override, expected) => {
    expect(
      resolveLastAgentSelection({
        runs: [],
        noteMode: false,
        isRoutable: () => true,
        route: noRoute,
        pick: null,
        ...override,
      }),
    ).toEqual(expected);
  });
});

describe("autoRoute", () => {
  const entry = (instanceId: string, driverKind: string, slugs: string[], isAvailable = true) => ({
    instanceId: ProviderInstanceId.make(instanceId),
    driverKind: ProviderDriverKind.make(driverKind),
    isAvailable,
    models: slugs.map((slug) => ({ slug })),
  });
  const entries = [
    entry("claudeAgent", "claudeAgent", [
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]),
    entry("codex", "codex", ["gpt-5.5"]),
    entry("antigravity", "antigravity", ["antigravity-default"]),
    entry("opencode", "acpRegistry", [
      "openrouter/qwen/qwen3",
      "openrouter/deepseek/deepseek-v4.1-flash",
    ]),
  ];
  const pick = (prompt: string, list = entries) => {
    const route = autoRoute(prompt, list, codex);
    return { topic: route.topic?.selection.model ?? null, general: route.general?.model ?? null };
  };

  it.each([
    ["fix the failing test in the parser", "gpt-5.5"],
    ["what's the latest news on humanoid robots", "antigravity-default"],
    ["scrape the prices off this website", null],
    ["help me plan the semester project", null],
    ["thanks!", null],
    [`hello there\n\n${VOICE_CALL_HINT}`, null],
  ])("%s → %s", (prompt, topic) => {
    expect(pick(prompt).topic).toBe(topic);
  });

  it("sends everything else to Opus", () => {
    expect(pick("hey what's up").general).toBe("claude-opus-5-5");
  });

  it("skips agents that aren't available", () => {
    const withoutCodex = entries.filter((candidate) => candidate.driverKind !== "codex");
    expect(pick("fix the bug", withoutCodex).topic).toBeNull();
    expect(pick("fix the bug", [entry("codex", "codex", ["gpt-5.5"])]).general).toBe("gpt-5.5");
  });
});

describe("claudeLast", () => {
  it("moves Claude to the end and keeps the others in order", () => {
    const gemini: ModelSelection = {
      instanceId: ProviderInstanceId.make("antigravity"),
      model: "g",
    };
    const order = claudeLast(
      [{ modelSelection: claude }, { modelSelection: codex }, { modelSelection: gemini }],
      (selection) => selection.instanceId === claude.instanceId,
    ).map((target) => target.modelSelection.instanceId);
    expect(order).toEqual(["codex", "antigravity", "claudeAgent"]);
  });
});

describe("foldGroupTurns", () => {
  it("shows a group message once, counting the agents queued behind it", () => {
    const folded = foldGroupTurns([
      { text: "@all plan it" },
      { text: GROUP_TURN_TEXT },
      { text: GROUP_TURN_TEXT },
      { text: "something else" },
    ]);
    expect(folded.map((item) => [item.text, item.followers])).toEqual([
      ["@all plan it", 2],
      ["something else", 0],
    ]);
  });

  it("keeps a group turn whose first message already ran", () => {
    expect(foldGroupTurns([{ text: GROUP_TURN_TEXT }]).map((item) => item.followers)).toEqual([0]);
  });
});
