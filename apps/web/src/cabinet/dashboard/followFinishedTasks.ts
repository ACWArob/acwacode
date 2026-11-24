import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  resolveThreadActivityTimestamp,
  toSortableTimestamp,
} from "@t3tools/client-runtime/state/thread-sort";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import type { AtomRegistry } from "effect/reactivity";

import { composerDraftHasUserContent, useComposerDraftStore } from "~/composerDraftStore";
import { filterSidebarV2VisibleThreads, resolveSidebarRowStatus } from "~/components/Sidebar.logic";
import { isAppModalPage } from "~/components/sidebar/mainAppLocation";
import {
  readLocalStorageValue,
  subscribeLocalStorageKey,
  useLocalStorage,
} from "~/hooks/useLocalStorage";
import { isEditableFocused } from "~/lib/editableFocus";
import { liveShellEnvironmentIdsAtom } from "~/state/shell";
import { environmentThreadShells } from "~/state/threads";
import {
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteTarget,
} from "~/threadRoutes";
import { cabinetRowStatus, type CabinetThreadStatus } from "../sidebar/cabinetStatus.logic";
import {
  type FollowThreadObservation,
  pickFinishedThreadToFollow,
} from "./followFinishedTasks.logic";

const FOLLOW_FINISHED_TASKS_STORAGE_KEY = "acwa:follow-finished-tasks:v1";
const FOLLOW_MIN_INTERVAL_MS = 5_000;
/** How long after the last keystroke the person counts as typing; also the retry delay. */
const TYPING_IDLE_MS = 2_000;

/** Per-device "Follow finished tasks" toggle. */
export function useFollowFinishedTasks() {
  return useLocalStorage(FOLLOW_FINISHED_TASKS_STORAGE_KEY, false, Schema.Boolean);
}

/** While the toggle is on, opens each top-level thread that finishes, for the life of the app. */
export function startFollowFinishedTasks(
  registry: AtomRegistry.AtomRegistry,
  router: AnyRouter,
): () => void {
  let stopWatching: (() => void) | null = null;
  const sync = () => {
    const enabled = readLocalStorageValue(FOLLOW_FINISHED_TASKS_STORAGE_KEY, false, Schema.Boolean);
    if (enabled && stopWatching === null) {
      stopWatching = watchFinishedTasks(registry, router);
    } else if (!enabled && stopWatching !== null) {
      stopWatching();
      stopWatching = null;
    }
  };
  const unsubscribe = subscribeLocalStorageKey(FOLLOW_FINISHED_TASKS_STORAGE_KEY, sync);
  sync();
  return () => {
    unsubscribe();
    stopWatching?.();
  };
}

function watchFinishedTasks(registry: AtomRegistry.AtomRegistry, router: AnyRouter): () => void {
  let previous = new Map<string, CabinetThreadStatus>();
  let refs = new Map<string, ScopedThreadRef>();
  let pendingKey: string | null = null;
  let lastFollowAt = Number.NEGATIVE_INFINITY;
  let lastInputAt = Number.NEGATIVE_INFINITY;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let ownNavigation = false;

  const readOpenTarget = () => resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});

  // Typing means a recent keystroke, an unsent message in the open composer, or focus in any
  // other text field. An empty, focused composer does not count: it takes focus on open.
  const isTyping = (now: number) => {
    if (now - lastInputAt < TYPING_IDLE_MS) return true;
    const target = readOpenTarget();
    if (target !== null) {
      const draft = useComposerDraftStore
        .getState()
        .getComposerDraft(target.kind === "server" ? target.threadRef : target.draftId);
      if (composerDraftHasUserContent(draft)) return true;
    }
    const active = document.activeElement;
    return (
      isEditableFocused(active) &&
      !(active instanceof Element && active.closest("[data-composer-rich-text]") !== null)
    );
  };

  const readOpenThreadKey = () => {
    const target = readOpenTarget();
    const draft =
      target?.kind === "draft"
        ? useComposerDraftStore.getState().getDraftSession(target.draftId)
        : null;
    const ref = resolveActiveThreadRouteRef(target, draft);
    return ref === null ? null : scopedThreadKey(ref);
  };

  const tryFollow = () => {
    clearTimeout(retry);
    retry = undefined;
    if (pendingKey === null) return;
    const ref = refs.get(pendingKey);
    // Settings and Usage are never left on their own.
    if (
      ref === undefined ||
      isAppModalPage(router.state.location.pathname) ||
      readOpenThreadKey() === pendingKey
    ) {
      pendingKey = null;
      return;
    }
    const now = Date.now();
    const wait = Math.max(
      lastFollowAt + FOLLOW_MIN_INTERVAL_MS - now,
      isTyping(now) ? TYPING_IDLE_MS : 0,
    );
    if (wait > 0) {
      retry = setTimeout(tryFollow, wait);
      return;
    }
    pendingKey = null;
    lastFollowAt = now;
    ownNavigation = true;
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(ref),
    });
  };

  const update = () => {
    const live = registry.get(liveShellEnvironmentIdsAtom);
    const listed = filterSidebarV2VisibleThreads(
      registry.get(environmentThreadShells.quietThreadShellsAtom),
      null,
      registry.get(environmentThreadShells.delegatedUnderParentAtom),
    );
    const observations: FollowThreadObservation[] = [];
    const nextRefs = new Map<string, ScopedThreadRef>();
    for (const thread of listed) {
      // A reconnecting environment's threads are forgotten, so its return never reads as a finish.
      if (!live.has(thread.environmentId)) continue;
      const ref = scopeThreadRef(thread.environmentId, thread.id);
      const key = scopedThreadKey(ref);
      nextRefs.set(key, ref);
      observations.push({
        key,
        status: cabinetRowStatus(resolveSidebarRowStatus(thread)).status,
        at: toSortableTimestamp(resolveThreadActivityTimestamp(thread) ?? undefined) ?? 0,
      });
    }
    const picked = pickFinishedThreadToFollow(previous, observations);
    previous = new Map(observations.map((observation) => [observation.key, observation.status]));
    refs = nextRefs;
    if (picked !== null) pendingKey = picked;
    else if (pendingKey !== null && (previous.get(pendingKey) ?? "working") === "working") {
      pendingKey = null;
    }
    tryFollow();
  };

  // Moving to another page by hand outranks a finish still waiting its turn.
  const onRouteResolved = () => {
    if (ownNavigation) {
      ownNavigation = false;
      return;
    }
    pendingKey = null;
    clearTimeout(retry);
    retry = undefined;
  };
  const onInput = () => {
    lastInputAt = Date.now();
  };

  window.addEventListener("input", onInput, true);
  const unsubscribes = [
    registry.subscribe(environmentThreadShells.quietThreadShellsAtom, update),
    registry.subscribe(environmentThreadShells.delegatedUnderParentAtom, update),
    registry.subscribe(liveShellEnvironmentIdsAtom, update),
    router.subscribe("onResolved", onRouteResolved),
  ];
  update();
  return () => {
    clearTimeout(retry);
    window.removeEventListener("input", onInput, true);
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
