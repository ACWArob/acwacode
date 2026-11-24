import { describe, expect, it } from "vite-plus/test";

import {
  callActivity,
  callCrew,
  callReadiness,
  callAgentKey,
  END_OF_TURN_SILENCE_MS,
  MAX_TURN_MS,
  nextSpeechChunk,
  skipAllReplies,
  speakableText,
  startBargeIn,
  startSilenceTracker,
  trackBargeIn,
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

describe("nextSpeechChunk", () => {
  const user = { id: "u1", runId: null, role: "user", text: "hi", streaming: false } as const;
  const claude = {
    id: "a1",
    runId: "r1",
    role: "assistant",
    text: "Hello! Let me look.",
    streaming: false,
  } as const;
  const gpt = { id: "a2", runId: "r2", role: "assistant", text: "Hey.", streaming: false } as const;
  const everyone = () => true;
  const none = new Map<string, number>();

  it("speaks each finished sentence of a reply while it is still streaming", () => {
    const streaming = { ...claude, text: "Hello! Let me lo", streaming: true };
    expect(nextSpeechChunk([user, streaming], none, everyone)).toEqual({
      messageId: "a1",
      end: 6,
      text: "Hello!",
    });
    expect(nextSpeechChunk([user, streaming], new Map([["a1", 6]]), everyone)).toBeNull();
    expect(nextSpeechChunk([user, claude], new Map([["a1", 6]]), everyone)).toEqual({
      messageId: "a1",
      end: claude.text.length,
      text: "Let me look.",
    });
  });

  it("speaks replies in order and holds later ones behind a streaming one", () => {
    const streaming = { ...claude, text: "Hello! Let me lo", streaming: true };
    expect(nextSpeechChunk([user, streaming, gpt], new Map([["a1", 6]]), everyone)).toBeNull();
    expect(
      nextSpeechChunk([user, claude, gpt], new Map([["a1", Infinity]]), everyone)?.messageId,
    ).toBe("a2");
  });

  it("waits for a code block to close instead of reading it", () => {
    const code = { ...claude, text: "Here:\n```ts\nconst a = 1;\nb();", streaming: true };
    expect(nextSpeechChunk([code], none, everyone)?.end).toBe(6);
    expect(nextSpeechChunk([code], new Map([["a1", 6]]), everyone)).toBeNull();
    const closed = { ...code, text: `${code.text}\n\`\`\`\nDone.\n` };
    expect(nextSpeechChunk([closed], new Map([["a1", 6]]), everyone)?.text).toBe(
      "(code is on screen) Done.",
    );
  });

  it("skips replies that are not spoken, such as teammates in a team call", () => {
    expect(
      nextSpeechChunk([user, gpt, claude], none, (message) => message.id === "a1")?.messageId,
    ).toBe("a1");
  });

  it("skips replies from before the turn once they are marked spoken", () => {
    expect(nextSpeechChunk([claude, user], skipAllReplies([claude, user], none), everyone)).toBe(
      null,
    );
  });

  it("stops a very long reply and points to the screen", () => {
    const long = { ...claude, text: "Word. ".repeat(400), streaming: true };
    expect(nextSpeechChunk([long], new Map([["a1", 1300]]), everyone)).toEqual({
      messageId: "a1",
      end: Infinity,
      text: "The rest is on screen.",
    });
  });
});

describe("trackBargeIn", () => {
  const feed = (levels: ReadonlyArray<number>) => {
    let tracker = startBargeIn();
    let bargeIn = false;
    for (const level of levels) {
      ({ tracker, bargeIn } = trackBargeIn(tracker, level));
      if (bargeIn) return true;
    }
    return false;
  };

  it("cuts in when the caller talks clearly over the agent", () => {
    expect(feed([0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.4, 0.4, 0.4, 0.4])).toBe(true);
  });

  it("ignores a steady echo of the agent's own voice and short noises", () => {
    expect(feed(Array.from({ length: 40 }, () => 0.22))).toBe(false);
    expect(feed([0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.5, 0.5, 0.05, 0.5, 0.5, 0.05])).toBe(false);
  });

  it("does not cut in while it is still learning the room", () => {
    expect(feed([0.5, 0.5, 0.5, 0.5])).toBe(false);
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

describe("callReadiness", () => {
  it.each([
    [{ available: true, destinationChosen: true, unsupportedReason: null }, "ready"],
    [{ available: false, destinationChosen: false, unsupportedReason: null }, "setup"],
    [{ available: true, destinationChosen: false, unsupportedReason: null }, "setup"],
    [{ available: false, destinationChosen: true, unsupportedReason: "No model" }, "unavailable"],
  ] as const)("%o → %s", (input, kind) => {
    expect(callReadiness(input).kind).toBe(kind);
  });

  it("passes the server's reason through", () => {
    expect(
      callReadiness({ available: false, destinationChosen: true, unsupportedReason: "No model" }),
    ).toEqual({ kind: "unavailable", reason: "No model" });
  });
});

describe("callCrew", () => {
  const child = (id: string, provider: string, model: string, createdAtMs: number, extra = {}) => ({
    id,
    title: `task ${id}`,
    providerInstanceId: provider,
    modelSelection: { model },
    delegatedFrom: { threadId: "call" },
    working: false,
    createdAtMs,
    ...extra,
  });

  it("shows each agent's newest task from this chat and whether it is working", () => {
    expect(
      callCrew(
        [
          child("g1", "antigravity", "antigravity-default", 1),
          child("g2", "antigravity", "antigravity-default", 2, { working: true }),
          child("c1", "codex", "gpt-6.2-sol", 1),
          { ...child("x", "codex", "gpt-6.2-sol", 9), delegatedFrom: { threadId: "other" } },
        ],
        "call",
      ),
    ).toEqual({
      gemini: { threadId: "g2", task: "task g2", working: true },
      gpt: { threadId: "c1", task: "task c1", working: false },
    });
  });
});
