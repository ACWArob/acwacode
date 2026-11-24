import type { AntigravitySettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import {
  parseTimestampMs,
  tokenCount,
  totalTokens,
  type ProviderUsageReader,
  type TranscriptUsageFormat,
  type UsageRecord,
} from "@t3tools/provider-core/server/usage";
import * as HostProcess from "@t3tools/shared/HostProcess";

/** Message lines carry no session id, and synthetic Gemini messages carry no model. */
const GeminiCliScanState = Schema.Struct({
  sessionId: Schema.mutableKey(Schema.String),
  model: Schema.mutableKey(Schema.String),
});
type GeminiCliScanState = typeof GeminiCliScanState.Type;

const initialGeminiCliScanState = (): GeminiCliScanState => ({ sessionId: "", model: "" });

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseGeminiCliRecord(parsed: unknown, state: GeminiCliScanState): readonly UsageRecord[] {
  const record = asRecord(parsed);
  if (record === null) return [];
  const metadata = asRecord(record["$set"]) ?? record;
  if (typeof metadata["sessionId"] === "string") state.sessionId = metadata["sessionId"];
  if (record["type"] !== "gemini") return [];

  const model = typeof record["model"] === "string" ? record["model"].trim() : "";
  if (model) state.model = model;
  const tokens = asRecord(record["tokens"]);
  if (tokens === null) return [];
  const timestampMs = parseTimestampMs(record["timestamp"]);
  if (timestampMs === null) return [];

  // `input` is promptTokenCount, which includes `cached`; `tool` is also prompt-side, and
  // `output` excludes `thoughts`.
  const cached = tokenCount(tokens["cached"]);
  const thoughts = tokenCount(tokens["thoughts"]);
  const totals = {
    uncachedInputTokens: Math.max(
      0,
      tokenCount(tokens["input"]) + tokenCount(tokens["tool"]) - cached,
    ),
    cachedInputTokens: cached,
    cacheCreationTokens: 0,
    outputTokens: tokenCount(tokens["output"]) + thoughts,
    reasoningTokens: thoughts,
  };
  if (totalTokens(totals) === 0) return [];

  const id = typeof record["id"] === "string" && record["id"].length > 0 ? record["id"] : null;
  return [
    {
      provider: "antigravity",
      timestampMs,
      model: model || state.model || "gemini",
      sessionId: state.sessionId,
      totals,
      reportedCostUsd: null,
      speed: "standard",
      // The CLI appends a message again each time its tool calls or tokens change.
      dedupeKey: id === null ? null : `gemini-cli:${id}`,
    },
  ];
}

export function parseGeminiCliLine(
  line: string,
  state: GeminiCliScanState,
): readonly UsageRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  return parseGeminiCliRecord(parsed, state);
}

export const geminiCliUsageFormat: TranscriptUsageFormat<GeminiCliScanState> = {
  selectFields: {
    type: true,
    id: true,
    timestamp: true,
    model: true,
    tokens: true,
    sessionId: true,
    $set: { sessionId: true },
  },
  // Lines whose tokens are still null carry no usage; metadata lines carry the session id.
  usageMarkers: ['"tokens":{', '"sessionId"'],
  parseLine: parseGeminiCliLine,
  parseProjected: parseGeminiCliRecord,
  state: { initial: initialGeminiCliScanState, schema: GeminiCliScanState },
};

/** Standalone Gemini CLI sessions: `<home>/.gemini/tmp/<project>/chats/*.jsonl`, subagents one level deeper. */
export const geminiCliUsageReader: ProviderUsageReader<AntigravitySettings, Path.Path> = {
  kind: "transcripts",
  provider: "antigravity",
  format: geminiCliUsageFormat,
  directories: Effect.fn("geminiCliUsageReader.directories")(function* ({ environment }) {
    const path = yield* Path.Path;
    const homeDirectory = yield* HostProcess.HomeDirectory;
    const home = expandHomePath(
      environment.GEMINI_CLI_HOME?.trim() || homeDirectory,
      homeDirectory,
    );
    // macOS seatbelt sandboxes keep runtime state under ~/.cache/.gemini instead.
    return [
      { dir: path.resolve(home, ".gemini", "tmp") },
      { dir: path.resolve(home, ".cache", ".gemini", "tmp") },
    ];
  }),
};
