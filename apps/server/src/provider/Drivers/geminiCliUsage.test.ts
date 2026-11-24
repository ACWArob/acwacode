// @effect-diagnostics nodeBuiltinImport:off - the transcript reader reads real files with node:fs.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import { dedupeWithinFile } from "../../usage/usageScanCache.ts";
import { readTranscriptRecords } from "../../usage/usageTranscriptReader.ts";
import { geminiCliUsageFormat, parseGeminiCliLine } from "./geminiCliUsage.ts";

const SESSION_ID = "8f14e45f-ceea-467a-9575-8a4e1c2d7b10";
const g1Tokens = { input: 12000, output: 300, cached: 8000, thoughts: 150, tool: 0, total: 12450 };
const g1 = {
  id: "g1",
  timestamp: "2026-11-20T10:00:05.000Z",
  type: "gemini",
  content: "Reading the file.",
  thoughts: [],
  model: "gemini-2.5-pro",
};

// Lines as ChatRecordingService appends them: metadata first, then each message again whenever it changes.
const sessionLines = [
  {
    sessionId: SESSION_ID,
    projectHash: "c0ffee",
    startTime: "2026-11-20T10:00:00.000Z",
    lastUpdated: "2026-11-20T10:00:00.000Z",
    kind: "main",
  },
  {
    id: "u1",
    timestamp: "2026-11-20T10:00:01.000Z",
    type: "user",
    content: [{ text: "Fix the failing test." }],
  },
  { ...g1, tokens: null },
  { $set: { lastUpdated: "2026-11-20T10:00:05.000Z" } },
  { ...g1, tokens: g1Tokens },
  {
    ...g1,
    tokens: g1Tokens,
    toolCalls: [
      {
        id: "t1",
        name: "read_file",
        args: {},
        status: "success",
        timestamp: "2026-11-20T10:00:06.000Z",
      },
    ],
  },
  { $patch: { id: "g1", toolCalls: [{ id: "t1", result: [{ text: "file body" }] }] } },
  // Older records omit thoughts and tool; unknown fields are ignored.
  {
    id: "g2",
    timestamp: "2026-11-20T10:01:00.000Z",
    type: "gemini",
    content: "Done.",
    tokens: { input: 13000, output: 40, cached: 12000, total: 13040 },
    model: "gemini-2.5-pro",
    futureField: { nested: true },
  },
  // Synthetic Gemini messages carry tokens but no model.
  {
    id: "g3",
    timestamp: "2026-11-20T10:02:00.000Z",
    type: "gemini",
    content: [{ text: "" }],
    tokens: { input: 500, output: 0, cached: 0, thoughts: 0, tool: 20, total: 520 },
  },
  { id: "i1", timestamp: "2026-11-20T10:03:00.000Z", type: "info", content: "Compressed." },
  { $rewindTo: "g2" },
];

describe("geminiCliUsageFormat", () => {
  it("reads one record per Gemini message from a session file", async () => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "gemini-cli-usage-"));
    try {
      const file = NodePath.join(dir, "session-2026-11-20T10-00-8f14e45f.jsonl");
      const body = sessionLines.map((line) => JSON.stringify(line)).join("\n");
      await NodeFSP.writeFile(file, `${body}\n{"id":"broken","type":"gemini","tokens":{\n`);

      const parsed = await readTranscriptRecords(file, geminiCliUsageFormat);
      const records = dedupeWithinFile(parsed?.records ?? []);

      expect(parsed?.tailRecords).toEqual([]);
      expect(
        records.map(({ model, sessionId, timestampMs, totals, dedupeKey, provider }) => ({
          provider,
          model,
          sessionId,
          timestampMs,
          totals,
          dedupeKey,
        })),
      ).toEqual([
        {
          provider: "antigravity",
          model: "gemini-2.5-pro",
          sessionId: SESSION_ID,
          timestampMs: Date.parse("2026-11-20T10:00:05.000Z"),
          totals: {
            uncachedInputTokens: 4000,
            cachedInputTokens: 8000,
            cacheCreationTokens: 0,
            outputTokens: 450,
            reasoningTokens: 150,
          },
          dedupeKey: "gemini-cli:g1",
        },
        {
          provider: "antigravity",
          model: "gemini-2.5-pro",
          sessionId: SESSION_ID,
          timestampMs: Date.parse("2026-11-20T10:01:00.000Z"),
          totals: {
            uncachedInputTokens: 1000,
            cachedInputTokens: 12000,
            cacheCreationTokens: 0,
            outputTokens: 40,
            reasoningTokens: 0,
          },
          dedupeKey: "gemini-cli:g2",
        },
        {
          provider: "antigravity",
          model: "gemini-2.5-pro",
          sessionId: SESSION_ID,
          timestampMs: Date.parse("2026-11-20T10:02:00.000Z"),
          totals: {
            uncachedInputTokens: 520,
            cachedInputTokens: 0,
            cacheCreationTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
          },
          dedupeKey: "gemini-cli:g3",
        },
      ]);
    } finally {
      await NodeFSP.rm(dir, { recursive: true, force: true });
    }
  });

  it("reads token fields defensively", () => {
    const line = (fields: Record<string, unknown>) =>
      parseGeminiCliLine(
        JSON.stringify({
          id: "m",
          timestamp: "2026-11-20T10:00:00.000Z",
          type: "gemini",
          model: "gemini-3-pro-preview",
          ...fields,
        }),
        geminiCliUsageFormat.state!.initial(),
      );

    expect(
      line({ tokens: { input: "12", output: -5, cached: 1000, thoughts: null } })[0]?.totals,
    ).toEqual({
      uncachedInputTokens: 0,
      cachedInputTokens: 1000,
      cacheCreationTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    });
    expect(line({ tokens: { input: 0, output: 0, cached: 0, total: 0 } })).toEqual([]);
    expect(line({ tokens: [12, 3] })).toEqual([]);
    expect(line({ tokens: { input: 10 }, timestamp: "not a date" })).toEqual([]);
    expect(line({ tokens: { input: 10 }, type: "user" })).toEqual([]);
    expect(line({ tokens: { input: 10 }, id: undefined })[0]?.dedupeKey).toBeNull();
    expect(
      parseGeminiCliLine("[1,2]", geminiCliUsageFormat.state!.initial()).concat(
        parseGeminiCliLine("{not json", geminiCliUsageFormat.state!.initial()),
      ),
    ).toEqual([]);
  });
});
