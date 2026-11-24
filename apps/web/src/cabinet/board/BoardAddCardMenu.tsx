import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import {
  FileDiffIcon,
  FolderIcon,
  LayoutGridIcon,
  MessageSquareIcon,
  PlusIcon,
} from "lucide-react";
import { useState } from "react";

import { filterSidebarV2VisibleThreads } from "~/components/Sidebar.logic";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuSearchInput,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { useDelegatedUnderParent, useProjects, useQuietThreadShells } from "~/state/entities";
import { boardKey, groupThreadsByProject, type ProjectThreadEntry } from "./board.logic";
import { useBoardStore } from "./boardStore";

const RECENT_THREAD_LIMIT = 8;
const OTHER_PROJECT_THREAD_LIMIT = 5;
const SEARCH_RESULT_LIMIT = 40;

/**
 * Threads of every project but the board's, from an already visibility-filtered list. Archived
 * threads and projects are left out. The command palette's split action reuses this.
 */
export function otherProjectThreads(
  threads: readonly Pick<
    EnvironmentThreadShell,
    | "environmentId"
    | "id"
    | "projectId"
    | "title"
    | "archivedAt"
    | "latestUserMessageAt"
    | "latestRun"
    | "updatedAt"
  >[],
  projects: readonly Pick<EnvironmentProject, "environmentId" | "id" | "title" | "archivedAt">[],
  boardProjectKey: string,
): ProjectThreadEntry[] {
  const projectTitles = new Map(
    projects.flatMap((project) =>
      project.archivedAt ? [] : [[boardKey(project.environmentId, project.id), project.title]],
    ),
  );
  return threads.flatMap((thread) => {
    const projectKey = boardKey(thread.environmentId, thread.projectId);
    const projectTitle = projectTitles.get(projectKey);
    if (thread.archivedAt !== null || projectKey === boardProjectKey || !projectTitle) return [];
    return [
      {
        threadKey: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        projectKey,
        projectTitle,
        title: thread.title,
        activityAt: resolveThreadActivityTimestamp(thread) ?? "",
      },
    ];
  });
}

/**
 * The top bar's Add card menu: another thread of this project or of another project, the route
 * thread's diff, or a 2×2 split across the most recently active projects.
 */
export function BoardAddCardMenu(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly primaryThreadKey: string;
  /** Null while the route shows a draft, which has no checkpoints to diff. */
  readonly onOpenPrimaryDiff: (() => void) | null;
  readonly onOpenThread: (threadKey: string) => void;
}) {
  const gt = useGT();
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="xs" />}>
        <PlusIcon />
        {gt("Add card")}
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuSub>
          <MenuSubTrigger>
            <MessageSquareIcon />
            {gt("Thread")}
          </MenuSubTrigger>
          <MenuSubPopup>
            <RecentThreadItems {...props} />
          </MenuSubPopup>
        </MenuSub>
        <MenuSub>
          <MenuSubTrigger>
            <FolderIcon />
            {gt("Thread from another project")}
          </MenuSubTrigger>
          <MenuSubPopup className="w-72">
            <OtherProjectThreadItems {...props} />
          </MenuSubPopup>
        </MenuSub>
        <MenuItem
          disabled={props.onOpenPrimaryDiff === null}
          onClick={() => props.onOpenPrimaryDiff?.()}
        >
          <FileDiffIcon />
          {gt("Diff of this thread")}
        </MenuItem>
        <MenuSeparator />
        <SplitAcrossProjectsItem {...props} />
      </MenuPopup>
    </Menu>
  );
}

// The items below mount only while their popup is open, so the board never re-renders on thread
// list changes.
function RecentThreadItems(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly primaryThreadKey: string;
  readonly onOpenThread: (threadKey: string) => void;
}) {
  const gt = useGT();
  const shells = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const threads = filterSidebarV2VisibleThreads(
    shells,
    new Set([`${props.environmentId}:${props.projectId}`]),
    delegatedUnderParent,
  )
    .map((thread) => ({
      thread,
      key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      at: resolveThreadActivityTimestamp(thread) ?? "",
    }))
    .filter((entry) => entry.key !== props.primaryThreadKey)
    .toSorted((a, b) => b.at.localeCompare(a.at))
    .slice(0, RECENT_THREAD_LIMIT);

  if (threads.length === 0) {
    return <MenuItem disabled>{gt("No other threads in this project")}</MenuItem>;
  }
  return threads.map(({ thread, key }) => (
    <MenuItem key={key} onClick={() => props.onOpenThread(key)}>
      <MenuItemLabel>{thread.title}</MenuItemLabel>
    </MenuItem>
  ));
}

function useOtherProjectThreads(environmentId: EnvironmentId, projectId: ProjectId) {
  const shells = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const projects = useProjects();
  return otherProjectThreads(
    filterSidebarV2VisibleThreads(shells, null, delegatedUnderParent),
    projects,
    boardKey(environmentId, projectId),
  );
}

function OtherProjectThreadItems(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly onOpenThread: (threadKey: string) => void;
}) {
  const gt = useGT();
  const [query, setQuery] = useState("");
  const threads = useOtherProjectThreads(props.environmentId, props.projectId);
  const groups = groupThreadsByProject(threads, query, {
    perProject: OTHER_PROJECT_THREAD_LIMIT,
    total: SEARCH_RESULT_LIMIT,
  });
  return (
    <>
      <MenuSearchInput
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder={gt("Search threads and projects")}
        aria-label={gt("Search threads and projects")}
      />
      {groups.length === 0 ? (
        <MenuItem disabled>
          {query.trim() === "" ? gt("No threads in other projects") : gt("No matching threads")}
        </MenuItem>
      ) : (
        groups.map((group) => (
          <MenuGroup key={group.projectKey}>
            <MenuGroupLabel>{group.projectTitle}</MenuGroupLabel>
            {group.threads.map((thread) => (
              <MenuItem key={thread.threadKey} onClick={() => props.onOpenThread(thread.threadKey)}>
                <MenuItemLabel>{thread.title}</MenuItemLabel>
              </MenuItem>
            ))}
          </MenuGroup>
        ))
      )}
    </>
  );
}

function SplitAcrossProjectsItem(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly primaryThreadKey: string;
}) {
  const gt = useGT();
  const threads = useOtherProjectThreads(props.environmentId, props.projectId);
  return (
    <MenuItem
      disabled={threads.length === 0}
      onClick={() =>
        useBoardStore
          .getState()
          .splitAcrossProjects(
            boardKey(props.environmentId, props.projectId),
            threads,
            props.primaryThreadKey,
          )
      }
    >
      <LayoutGridIcon />
      {gt("Split across projects")}
    </MenuItem>
  );
}
