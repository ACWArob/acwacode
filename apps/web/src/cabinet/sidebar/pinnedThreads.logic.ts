import type { EnvironmentId } from "@t3tools/contracts";

/** Pinned threads in pin order with the shown project that owns each; threads of hidden projects drop out. */
export function pinnedThreadCards<
  TGroup extends {
    readonly memberProjectRefs: ReadonlyArray<{
      readonly environmentId: EnvironmentId;
      readonly projectId: string;
    }>;
  },
  TThread extends { readonly environmentId: EnvironmentId; readonly projectId: string },
>(
  groups: ReadonlyArray<TGroup>,
  pinnedThreads: ReadonlyArray<TThread>,
): ReadonlyArray<{ readonly thread: TThread; readonly group: TGroup }> {
  const groupByProject = new Map<string, TGroup>();
  for (const group of groups) {
    for (const ref of group.memberProjectRefs) {
      groupByProject.set(`${ref.environmentId}:${ref.projectId}`, group);
    }
  }
  return pinnedThreads.flatMap((thread) => {
    const group = groupByProject.get(`${thread.environmentId}:${thread.projectId}`);
    return group === undefined ? [] : [{ thread, group }];
  });
}
