export type VoiceCallPhase = "off" | "listening" | "sending" | "waiting" | "speaking";

export interface SilenceTracker {
  readonly heardSpeech: boolean;
  readonly quietSinceMs: number | null;
  readonly startedAtMs: number;
}

// Mic level is the worklet's smoothed RMS × 4, clamped to 0–1.
const SPEECH_LEVEL = 0.12;
const QUIET_LEVEL = 0.07;
export const END_OF_TURN_SILENCE_MS = 1300;
export const MAX_TURN_MS = 60_000;

export const startSilenceTracker = (nowMs: number): SilenceTracker => ({
  heardSpeech: false,
  quietSinceMs: null,
  startedAtMs: nowMs,
});

/** Advances the tracker with one level sample; `done` means the caller stopped talking. */
export function trackSilence(
  tracker: SilenceTracker,
  level: number,
  nowMs: number,
): { readonly tracker: SilenceTracker; readonly done: boolean } {
  if (nowMs - tracker.startedAtMs >= MAX_TURN_MS) return { tracker, done: tracker.heardSpeech };
  if (level >= SPEECH_LEVEL) {
    return { tracker: { ...tracker, heardSpeech: true, quietSinceMs: null }, done: false };
  }
  if (!tracker.heardSpeech || level >= QUIET_LEVEL) {
    return { tracker: { ...tracker, quietSinceMs: null }, done: false };
  }
  const quietSinceMs = tracker.quietSinceMs ?? nowMs;
  return {
    tracker: { ...tracker, quietSinceMs },
    done: nowMs - quietSinceMs >= END_OF_TURN_SILENCE_MS,
  };
}

// Keep topic words (code, search, …) out of these hints: autoRoute reads the whole draft.
export const VOICE_CALL_HINT =
  "(Voice call: answer in a few short spoken sentences. Put anything long in the chat, not in the spoken part. If the caller gives you a job by name, say in a sentence that you're on it, then do it.)";

export const VOICE_TEAM_HINT =
  "(Voice call, team: work this out together in the chat in writing, like a team. Claude leads as the project manager and speaks last. Only Claude's reply is read aloud, so Claude ends with a few short spoken sentences: the plan and who does what.)";

const MAX_SPOKEN_CHARS = 700;

/** Turns a Markdown reply into text that sounds natural read aloud. */
export function speakableText(markdown: string): string {
  const plain = markdown
    .replace(/```[\s\S]*?(```|$)/g, " (code is on screen) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(\S[\s\S]*?\S|\S)\1/g, "$2")
    .replace(/https?:\/\/\S+/g, "a link")
    // A chunk cut from a streaming reply can carry one half of a Markdown pair.
    .replace(/[*`#|>~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= MAX_SPOKEN_CHARS) return plain;
  const cut = plain.slice(0, MAX_SPOKEN_CHARS);
  const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return `${sentenceEnd > 200 ? cut.slice(0, sentenceEnd + 1) : cut} The rest is on screen.`;
}

export interface CallMessage {
  readonly id: string;
  readonly runId: string | null;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly streaming: boolean;
}

/** How far into each reply the call has spoken, in raw text offsets; Infinity means done or skipped. */
export type SpokenProgress = ReadonlyMap<string, number>;

export interface SpeechChunk {
  readonly messageId: string;
  /** Offset to record as spoken once this chunk is handed to the voice. */
  readonly end: number;
  readonly text: string;
}

// Past this many characters of one reply, the rest stays on screen.
const MAX_SPOKEN_RAW = 1200;
const SENTENCE_END = /[.!?:;](?=\s)|\n/g;

/** End of the last whole sentence after `from` that is not inside an open code block. */
function speakableBoundary(text: string, from: number): number {
  let boundary = from;
  for (const match of text.slice(from).matchAll(SENTENCE_END)) {
    boundary = from + match.index + match[0].length;
  }
  const fenceCount = text.slice(0, boundary).split("```").length - 1;
  if (fenceCount % 2 === 1) boundary = Math.max(from, text.lastIndexOf("```", boundary - 1));
  return boundary;
}

/**
 * The next piece of a reply to say aloud. Replies are spoken in order, each sentence as soon as
 * it is written, so a reply that is still streaming holds back the ones after it.
 */
export function nextSpeechChunk(
  messages: ReadonlyArray<CallMessage>,
  spoken: SpokenProgress,
  shouldSpeak: (message: CallMessage) => boolean,
): SpeechChunk | null {
  for (const message of messages) {
    if (message.role !== "assistant" || !shouldSpeak(message)) continue;
    const from = spoken.get(message.id) ?? 0;
    if (from === Infinity) continue;
    if (from >= MAX_SPOKEN_RAW && (message.streaming || from < message.text.length)) {
      return { messageId: message.id, end: Infinity, text: "The rest is on screen." };
    }
    const end = message.streaming ? speakableBoundary(message.text, from) : message.text.length;
    const text = end > from ? speakableText(message.text.slice(from, end)) : "";
    if (text !== "") return { messageId: message.id, end, text };
    if (message.streaming) return null;
  }
  return null;
}

/** Marks every reply so far as spoken: the caller talked over them or they predate this turn. */
export function skipAllReplies(
  messages: ReadonlyArray<CallMessage>,
  spoken: SpokenProgress,
): SpokenProgress {
  const next = new Map(spoken);
  for (const message of messages) next.set(message.id, Infinity);
  return next;
}

export interface BargeInTracker {
  readonly samples: number;
  readonly baseline: number;
  readonly loudSamples: number;
}

// The baseline follows the room and any echo of the agent's own voice, so only the caller
// speaking clearly over it counts as cutting in.
const BARGE_IN_WARMUP_SAMPLES = 5;
const BARGE_IN_MIN_LEVEL = 0.18;
const BARGE_IN_RATIO = 2.2;
const BARGE_IN_SAMPLES = 4;
const BASELINE_ALPHA = 0.05;

export const startBargeIn = (): BargeInTracker => ({ samples: 0, baseline: 0, loudSamples: 0 });

/** Advances the tracker with one mic level sample; `bargeIn` means the caller is talking over. */
export function trackBargeIn(
  tracker: BargeInTracker,
  level: number,
): { readonly tracker: BargeInTracker; readonly bargeIn: boolean } {
  const loud =
    tracker.samples >= BARGE_IN_WARMUP_SAMPLES &&
    level >= Math.max(BARGE_IN_MIN_LEVEL, tracker.baseline * BARGE_IN_RATIO);
  const loudSamples = loud ? tracker.loudSamples + 1 : 0;
  const alpha = Math.max(BASELINE_ALPHA, 1 / (tracker.samples + 1));
  const baseline = loud ? tracker.baseline : tracker.baseline + (level - tracker.baseline) * alpha;
  return {
    tracker: { samples: tracker.samples + 1, baseline, loudSamples },
    bargeIn: loudSamples >= BARGE_IN_SAMPLES,
  };
}

export interface VoiceProfile {
  readonly lang: string;
  readonly nameHints: RegExp;
  readonly pitch: number;
  readonly rate: number;
}

const VOICE_PROFILES = {
  claude: {
    lang: "en-GB",
    nameHints: /daniel|arthur|oliver|male|uk english male/i,
    pitch: 0.95,
    rate: 1.0,
  },
  gpt: {
    lang: "en-US",
    nameHints: /alex|aaron|fred|tom|male|us english male/i,
    pitch: 0.9,
    rate: 1.05,
  },
  gemini: {
    lang: "en-US",
    nameHints: /samantha|ava|allison|female|us english female/i,
    pitch: 1.1,
    rate: 1.05,
  },
  // DeepSeek and the other open models: a kid (high, quick voice).
  kid: { lang: "en-US", nameHints: /junior|kid|child|samantha|ava/i, pitch: 1.7, rate: 1.15 },
} as const satisfies Record<string, VoiceProfile>;

/** Picks a voice by who answered: provider instance id plus model name. */
export function voiceProfileFor(speaker: string): VoiceProfile {
  const key = speaker.toLowerCase();
  if (/claude|anthropic|opus|sonnet|haiku/.test(key)) return VOICE_PROFILES.claude;
  if (/gemini|antigravity|google/.test(key)) return VOICE_PROFILES.gemini;
  if (/deepseek|kimi|qwen|glm|minimax|opencode|mimo/.test(key)) return VOICE_PROFILES.kid;
  if (/codex|gpt|openai/.test(key)) return VOICE_PROFILES.gpt;
  return VOICE_PROFILES.claude;
}

/** Any turn item; fields are read defensively because their shapes differ by type. */
export interface CallActivityItem {
  readonly id: string;
  readonly type: string;
  readonly runId: string | null;
  readonly [field: string]: unknown;
}

export interface CallActivityRow {
  readonly id: string;
  readonly runId: string | null;
  readonly kind: "command" | "file" | "search" | "tool" | "agent" | "image";
  readonly text: string;
}

const oneLine = (text: string, max = 90) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** The latest things the agents did, newest last, as short lines for the call screen. */
export function callActivity(
  items: ReadonlyArray<CallActivityItem>,
  limit = 8,
): ReadonlyArray<CallActivityRow> {
  const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);
  const count = (value: unknown) => (typeof value === "number" ? value : null);
  const rows: CallActivityRow[] = [];
  for (const item of items) {
    const base = { id: item.id, runId: item.runId };
    const input = text(item.input);
    const fileName = text(item.fileName);
    const prompt = text(item.prompt);
    const imagePath = text(item.viewedImagePath);
    const toolName = text(item.toolName);
    if (item.type === "command_execution" && input) {
      rows.push({ ...base, kind: "command", text: oneLine(input) });
    } else if (item.type === "file_change" && fileName) {
      const additions = count(item.additions);
      const deletions = count(item.deletions);
      const counts =
        additions !== null || deletions !== null ? ` (+${additions ?? 0} −${deletions ?? 0})` : "";
      rows.push({ ...base, kind: "file", text: `Edited ${fileName}${counts}` });
    } else if (item.type === "web_search") {
      const patterns = Array.isArray(item.patterns) ? item.patterns.filter(text) : [];
      rows.push({
        ...base,
        kind: "search",
        text: oneLine(`Searched ${patterns.length > 0 ? patterns.join(", ") : "the web"}`),
      });
    } else if (item.type === "subagent" && prompt) {
      const progress = text(item.progress);
      rows.push({
        ...base,
        kind: "agent",
        text: oneLine(
          `${text(item.driver) ?? "Agent"}: ${prompt}${progress ? ` (${progress})` : ""}`,
        ),
      });
    } else if (item.type === "dynamic_tool" && imagePath) {
      rows.push({ ...base, kind: "image", text: `Looked at ${imagePath.split("/").pop()}` });
    } else if (item.type === "dynamic_tool" && toolName) {
      rows.push({
        ...base,
        kind: "tool",
        text: oneLine(toolName.replace(/^mcp__[^_]+__/, "").replaceAll("_", " ")),
      });
    }
  }
  return rows.slice(-limit);
}

export const CALL_AGENTS = [
  { key: "claude", label: "Claude" },
  { key: "gpt", label: "ChatGPT" },
  { key: "gemini", label: "Gemini" },
  { key: "open", label: "DeepSeek" },
] as const;

export type CallAgentKey = (typeof CALL_AGENTS)[number]["key"];

/** Which call-screen bubble a speaker (provider instance and model) lights up. */
export function callAgentKey(speaker: string | null): CallAgentKey | null {
  if (!speaker) return null;
  if (/gemini|antigravity/i.test(speaker)) return "gemini";
  if (/deepseek|kimi|qwen|glm|minimax|opencode|mimo/i.test(speaker)) return "open";
  if (/codex|gpt/i.test(speaker)) return "gpt";
  return "claude";
}

export interface CrewThread {
  readonly id: string;
  readonly title: string;
  readonly providerInstanceId: string;
  readonly modelSelection: { readonly model: string };
  readonly delegatedFrom?: { readonly threadId: string } | null | undefined;
  readonly working: boolean;
  readonly createdAtMs: number;
}

export interface CrewMember {
  readonly threadId: string;
  readonly task: string;
  readonly working: boolean;
}

/** What each agent was handed from this call's chat: its newest delegated task and whether it's on it. */
export function callCrew(
  threads: ReadonlyArray<CrewThread>,
  callThreadId: string,
): Partial<Record<CallAgentKey, CrewMember>> {
  const crew: Partial<Record<CallAgentKey, CrewMember & { readonly createdAtMs: number }>> = {};
  for (const thread of threads) {
    if (thread.delegatedFrom?.threadId !== callThreadId) continue;
    const key = callAgentKey(`${thread.providerInstanceId} ${thread.modelSelection.model}`);
    if (!key) continue;
    const current = crew[key];
    if (current && current.createdAtMs >= thread.createdAtMs) continue;
    crew[key] = {
      threadId: thread.id,
      task: thread.title,
      working: thread.working,
      createdAtMs: thread.createdAtMs,
    };
  }
  return Object.fromEntries(
    Object.entries(crew).map(([key, { createdAtMs: _, ...member }]) => [key, member]),
  );
}

const CALL_SCREEN_KEY = "acwa-call-screen";
const TALK_TO_CUT_IN_KEY = "acwa-call-talk-to-cut-in";

/** Whether talking over an agent cuts it off; laptop speakers can echo into the mic. */
export function readTalkToCutIn(): boolean {
  try {
    return window.localStorage.getItem(TALK_TO_CUT_IN_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeTalkToCutIn(enabled: boolean): void {
  try {
    window.localStorage.setItem(TALK_TO_CUT_IN_KEY, enabled ? "1" : "0");
  } catch {
    // Storage can be unavailable (private mode); the choice just won't persist.
  }
}

/** The web app on a phone is used for calls (the T3 Code mobile app is for typing). */
function isPhoneApp(): boolean {
  try {
    return window.matchMedia("(max-width: 640px)").matches;
  } catch {
    return false;
  }
}

/** The call screen stays open or closed across chat switches in this tab; the phone app opens on it. */
export function readCallScreenOpen(): boolean {
  try {
    const stored = window.sessionStorage.getItem(CALL_SCREEN_KEY);
    return stored === null ? isPhoneApp() : stored === "1";
  } catch {
    return isPhoneApp();
  }
}

export function writeCallScreenOpen(open: boolean): void {
  try {
    window.sessionStorage.setItem(CALL_SCREEN_KEY, open ? "1" : "0");
  } catch {
    // Storage can be unavailable (private mode); the screen just won't persist.
  }
}

export type CallReadiness =
  | { readonly kind: "ready" }
  | { readonly kind: "setup" }
  | { readonly kind: "unavailable"; readonly reason: string };

/** Why a call can't start yet, so the call screen can say so instead of greying out. */
export function callReadiness(input: {
  readonly available: boolean;
  readonly destinationChosen: boolean;
  readonly unsupportedReason: string | null;
}): CallReadiness {
  // A device that never chose where voice goes reports "available" so its first tap opens setup.
  if (!input.destinationChosen) return { kind: "setup" };
  if (input.available) return { kind: "ready" };
  return {
    kind: "unavailable",
    reason:
      input.unsupportedReason ??
      "Voice isn't ready on this device yet. Check the microphone permission and Voice settings.",
  };
}
