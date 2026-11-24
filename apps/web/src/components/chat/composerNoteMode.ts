import type { ModelSelection, OrchestrationV2Run } from "@t3tools/contracts";
import { create } from "zustand";

import type { ProviderInstanceEntry } from "../../providerInstances";

/** Channels the user switched to notes; in memory, so a reload returns to the last agent. */
export const useComposerNoteModeStore = create<{
  readonly noteThreadKeys: Readonly<Record<string, true>>;
  readonly toggle: (threadKey: string) => void;
}>((set) => ({
  noteThreadKeys: {},
  toggle: (threadKey) =>
    set(({ noteThreadKeys }) => {
      if (!noteThreadKeys[threadKey])
        return { noteThreadKeys: { ...noteThreadKeys, [threadKey]: true } };
      const { [threadKey]: _removed, ...rest } = noteThreadKeys;
      return { noteThreadKeys: rest };
    }),
}));

/**
 * Who a message without an @mention goes to, unless the user switched to notes (null posts a
 * note): a clear topic picks its paid agent, a follow-up stays with the channel's last agent, and
 * anything else goes to the general pick (Opus).
 */
export function resolveLastAgentSelection(input: {
  readonly runs: ReadonlyArray<Pick<OrchestrationV2Run, "ordinal" | "modelSelection">>;
  readonly noteMode: boolean;
  readonly isRoutable: (selection: ModelSelection) => boolean;
  readonly route: AutoRoute;
}): ModelSelection | null {
  if (input.noteMode) return null;
  if (input.route.topic) return input.route.topic.selection;
  const latest = input.runs.reduce<(typeof input.runs)[number] | null>(
    (best, run) => (best === null || run.ordinal > best.ordinal ? run : best),
    null,
  );
  if (latest !== null && input.isRoutable(latest.modelSelection)) return latest.modelSelection;
  return input.route.general;
}

type RouteEntry = Pick<ProviderInstanceEntry, "instanceId" | "driverKind" | "isAvailable"> & {
  readonly models: ReadonlyArray<{
    readonly slug: string;
    readonly isDefault?: boolean | undefined;
  }>;
};

export interface AutoRoute {
  readonly topic: { readonly reason: string; readonly selection: ModelSelection } | null;
  readonly general: ModelSelection | null;
}

const TOPIC_ROUTES: ReadonlyArray<{
  readonly reason: string;
  readonly driver: string;
  readonly model: RegExp | null;
  readonly matches: (prompt: string) => boolean;
}> = [
  {
    reason: "code",
    driver: "codex",
    model: null,
    matches: (prompt) =>
      prompt.includes("```") ||
      /\b(code|bug|fix|error|refactor|implement|function|tests?|compile|build|deploy|repo|commit|script|typescript|python)\b/i.test(
        prompt,
      ),
  },
  {
    reason: "research",
    driver: "antigravity",
    model: null,
    matches: (prompt) =>
      /\b(research|latest|news|search|look up|find out|compare|sources|papers?|summari[sz]e)\b/i.test(
        prompt,
      ),
  },
];

const pickModel = (entries: ReadonlyArray<RouteEntry>, driver: string, model: RegExp | null) => {
  const entry = entries.find(
    (candidate) => candidate.driverKind === driver && candidate.isAvailable,
  );
  const slug =
    (model ? entry?.models.find((candidate) => model.test(candidate.slug)) : undefined) ??
    entry?.models.find((candidate) => candidate.isDefault) ??
    entry?.models[0];
  return entry && slug ? { instanceId: entry.instanceId, model: slug.slug } : null;
};

/** Picks an agent from what the message says, so the user doesn't have to @ one each time. */
export function autoRoute(
  prompt: string,
  entries: ReadonlyArray<RouteEntry>,
  fallback: ModelSelection,
): AutoRoute {
  let topic: AutoRoute["topic"] = null;
  for (const route of TOPIC_ROUTES) {
    if (!route.matches(prompt)) continue;
    const selection = pickModel(entries, route.driver, route.model);
    if (selection) {
      topic = { reason: route.reason, selection };
      break;
    }
  }
  const general =
    pickModel(entries, "claudeAgent", /opus/i) ??
    (entries.some((entry) => entry.instanceId === fallback.instanceId && entry.isAvailable)
      ? fallback
      : null);
  return { topic, general };
}
