import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  resolveThreadActivityTimestamp,
  toSortableTimestamp,
} from "@t3tools/client-runtime/state/thread-sort";

import { normalizeSearchText } from "~/lib/utils";
import type { CabinetThreadStatus } from "../sidebar/cabinetStatus.logic";

const DASHBOARD_RECENT_THREAD_COUNT = 3;

interface DashboardProject {
  readonly id: string;
  readonly environmentId: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly archivedAt?: string | null | undefined;
  readonly updatedAt: string;
}

type DashboardThread = Pick<
  EnvironmentThreadShell,
  "latestUserMessageAt" | "latestRun" | "updatedAt"
> & {
  readonly id: string;
  readonly environmentId: string;
  readonly projectId: string;
};

export interface DashboardProjectSummary<P, T> {
  readonly project: P;
  readonly runningCount: number;
  readonly attentionCount: number;
  readonly lastActiveAt: string | null;
  readonly recentThreads: ReadonlyArray<T>;
}

const projectKey = (environmentId: string, projectId: string) =>
  `${environmentId}\u0000${projectId}`;

/**
 * One card per non-archived project matching `query`: busy projects (a chat running or needing
 * the user) first, then by last activity. `threads` should already be the listed ones.
 */
export function summarizeDashboardProjects<
  P extends DashboardProject,
  T extends DashboardThread,
>(input: {
  readonly projects: ReadonlyArray<P>;
  readonly threads: ReadonlyArray<T>;
  readonly statusOf: (thread: T) => CabinetThreadStatus;
  readonly query: string;
}): DashboardProjectSummary<P, T>[] {
  const query = normalizeSearchText(input.query);
  const shown = input.projects.filter(
    (project) =>
      project.archivedAt == null &&
      (query === "" ||
        normalizeSearchText(project.title).includes(query) ||
        normalizeSearchText(project.workspaceRoot).includes(query)),
  );
  const threadsByProject = new Map<string, Array<{ thread: T; at: string | null; ms: number }>>(
    shown.map((project) => [projectKey(project.environmentId, project.id), []]),
  );
  for (const thread of input.threads) {
    const bucket = threadsByProject.get(projectKey(thread.environmentId, thread.projectId));
    if (bucket === undefined) continue;
    const at = resolveThreadActivityTimestamp(thread);
    bucket.push({ thread, at, ms: toSortableTimestamp(at ?? undefined) ?? 0 });
  }

  return shown
    .map((project) => {
      const entries = (
        threadsByProject.get(projectKey(project.environmentId, project.id)) ?? []
      ).toSorted(
        (left, right) => right.ms - left.ms || compareIds(left.thread.id, right.thread.id),
      );
      let runningCount = 0;
      let attentionCount = 0;
      for (const { thread } of entries) {
        const status = input.statusOf(thread);
        if (status === "working") runningCount += 1;
        else if (status === "waiting" || status === "failed") attentionCount += 1;
      }
      const lastActiveAt = entries[0]?.at ?? project.updatedAt;
      return {
        summary: {
          project,
          runningCount,
          attentionCount,
          lastActiveAt,
          recentThreads: entries
            .slice(0, DASHBOARD_RECENT_THREAD_COUNT)
            .map((entry) => entry.thread),
        },
        busy: runningCount + attentionCount > 0,
        lastActiveMs: toSortableTimestamp(lastActiveAt) ?? 0,
      };
    })
    .toSorted(
      (left, right) =>
        Number(right.busy) - Number(left.busy) ||
        right.lastActiveMs - left.lastActiveMs ||
        left.summary.project.title.localeCompare(right.summary.project.title) ||
        compareIds(left.summary.project.id, right.summary.project.id),
    )
    .map(({ summary }) => summary);
}

function compareIds(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
