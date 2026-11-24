import { describe, expect, it } from "vite-plus/test";

import {
  callActivity,
  callAgentKey,
  END_OF_TURN_SILENCE_MS,
  MAX_TURN_MS,
  repliesToSpeak,
  speakableText,
  startSilenceTracker,
  trackSilence,
  voiceProfileFor,
} from "./voiceCall.logic";

const run = (samples: ReadonlyArray<readonly [level: number, atMs: number]>) => {
  let tracker = startSilenceTracker(0);
  let done = false;
  for (const [level, atMs] of samples) {
    ({ tracker, done } = trackSilence(tracker, level, atMs));
  }
  return done;
};

describe("trackSilence", () => {
  it("ends the turn only after speech followed by enough quiet", () => {
    expect(
      run([
        [0.01, 100],
        [0.01, 5000],
      ]),
    ).toBe(false);
    expect(
      run([
        [0.4, 100],
        [0.02, 200],
        [0.02, 200 + END_OF_TURN_SILENCE_MS - 1],
      ]),
    ).toBe(false);
    expect(
      run([
        [0.4, 100],
        [0.02, 200],
        [0.02, 200 + END_OF_TURN_SILENCE_MS],
      ]),
    ).toBe(true);
  });

  it("restarts the quiet timer when the caller speaks again", () => {
    expect(
      run([
        [0.4, 100],
        [0.02, 200],
        [0.5, 1000],
        [0.02, 1100],
        [0.02, 1100 + END_OF_TURN_SILENCE_MS - 1],
      ]),
    ).toBe(false);
  });

  it("ends a turn that ran past the limit only if something was said", () => {
    expect(
      run([
        [0.4, 100],
        [0.4, MAX_TURN_MS],
      ]),
    ).toBe(true);
    expect(run([[0.01, MAX_TURN_MS]])).toBe(false);
  });
});

describe("speakableText", () => {
  it("drops Markdown syntax and replaces code blocks", () => {
    expect(
      speakableText(
        "## Fix\nUse **`vp test`** and see [the docs](https://x.dev).\n```ts\nconst a = 1;\n```\n- done",
      ),
    ).toBe("Fix Use vp test and see the docs. (code is on screen) done");
  });

  it("cuts long replies at a sentence and points to the screen", () => {
    const spoken = speakableText(`${"This is a sentence. ".repeat(60)}`);
    expect(spoken.endsWith("The rest is on screen.")).toBe(true);
    expect(spoken.length).toBeLessThan(760);
  });
});

describe("repliesToSpeak", () => {
  const user = { id: "u1", runId: null, role: "user", text: "hi", streaming: false } as const;
  const claude = {
    id: "a1",
    runId: "r1",
    role: "assistant",
    text: "Hello!",
    streaming: false,
  } as const;
  const gpt = { id: "a2", runId: "r2", role: "assistant", text: "Hey.", streaming: false } as const;

  it("returns every finished reply after the last question, in order", () => {
    expect(repliesToSpeak([user, claude, gpt], new Set())).toEqual([claude, gpt]);
  });

  it("holds back replies behind one that is still streaming", () => {
    expect(repliesToSpeak([user, { ...claude, streaming: true }, gpt], new Set())).toEqual([]);
    expect(repliesToSpeak([user, claude, { ...gpt, streaming: true }], new Set())).toEqual([
      claude,
    ]);
  });

  it("skips replies already spoken or from before the question", () => {
    expect(repliesToSpeak([user, claude, gpt], new Set(["a1"]))).toEqual([gpt]);
    expect(repliesToSpeak([claude, user], new Set())).toEqual([]);
  });
});

describe("voiceProfileFor", () => {
  it("gives each agent family its own voice", () => {
    expect(voiceProfileFor("claudeAgent claude-opus-5-5").lang).toBe("en-GB");
    expect(voiceProfileFor("codex gpt-6.1-sol").nameHints.test("Alex")).toBe(true);
    expect(voiceProfileFor("gemini gemini-3.8-pro").nameHints.test("Samantha")).toBe(true);
    expect(
      voiceProfileFor("opencode openrouter/deepseek/deepseek-v4.1-flash").pitch,
    ).toBeGreaterThan(1.4);
  });
});

describe("callActivity", () => {
  it("turns turn items into short lines, newest last", () => {
    expect(
      callActivity([
        { id: "1", runId: "r", type: "command_execution", input: "vp test run\n  apps/web" },
        {
          id: "2",
          runId: "r",
          type: "file_change",
          fileName: "src/a.ts",
          additions: 3,
          deletions: 1,
        },
        { id: "3", runId: "r", type: "dynamic_tool", toolName: "mcp__t3-code__preview_snapshot" },
        {
          id: "4",
          runId: "r",
          type: "subagent",
          driver: "codex",
          prompt: "Fix the test",
          progress: "running",
        },
        { id: "5", runId: "r", type: "assistant_message" },
      ]).map((row) => row.text),
    ).toEqual([
      "vp test run apps/web",
      "Edited src/a.ts (+3 −1)",
      "preview snapshot",
      "codex: Fix the test (running)",
    ]);
  });

  it("keeps only the latest rows", () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      id: String(index),
      runId: null,
      type: "command_execution",
      input: `step ${index}`,
    }));
    expect(callActivity(items, 3).map((row) => row.text)).toEqual(["step 9", "step 10", "step 11"]);
  });
});

describe("callAgentKey", () => {
  it.each([
    ["claudeAgent claude-opus-5-5", "claude"],
    ["codex gpt-5.5", "gpt"],
    ["antigravity antigravity-default", "gemini"],
    ["acpRegistry_opencode openrouter/deepseek/deepseek-v4.1-flash", "open"],
    [null, null],
  ])("%s → %s", (speaker, key) => {
    expect(callAgentKey(speaker)).toBe(key);
  });
});
