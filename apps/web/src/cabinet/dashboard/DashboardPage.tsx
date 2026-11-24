import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { useRouter } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { PlusIcon, SearchIcon, SquarePenIcon } from "lucide-react";
import { useState } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { ProjectFavicon } from "~/components/ProjectFavicon";
import { filterSidebarV2VisibleThreads } from "~/components/Sidebar.logic";
import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { SidebarInset } from "~/components/ui/sidebar";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useNowMinute } from "~/hooks/useNowMinute";
import { workspaceAreaProps } from "~/lib/workspaceFocus";
import {
  useAllEnvironmentProjectSnapshotsReady,
  useDelegatedUnderParent,
  useProjects,
  useQuietThreadShells,
} from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useUiStateStore } from "~/uiStateStore";
import { cabinetThreadStatus } from "../sidebar/cabinetStatus.logic";
import { CabinetThreadStatusDot } from "../sidebar/CabinetThreadRow";
import { summarizeDashboardProjects, type DashboardProjectSummary } from "./dashboard.logic";

type ThreadStatus = ReturnType<typeof cabinetThreadStatus>;

const threadKeyOf = (thread: EnvironmentThreadShell) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

export function DashboardPage() {
  const gt = useGT();
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  const projects = useProjects();
  const projectsReady = useAllEnvironmentProjectSnapshotsReady();
  // Quiet shells, so streaming replies do not re-render every card.
  const threads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const lastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const nowMinute = useNowMinute();
  const [query, setQuery] = useState("");

  const listed = filterSidebarV2VisibleThreads(threads, null, delegatedUnderParent);
  const statusByKey = new Map<string, ThreadStatus>();
  for (const thread of listed) {
    const key = threadKeyOf(thread);
    statusByKey.set(key, cabinetThreadStatus(thread, lastVisitedAtById[key]));
  }
  const summaries = summarizeDashboardProjects({
    projects,
    threads: listed,
    statusOf: (thread) => statusByKey.get(threadKeyOf(thread))?.status ?? "idle",
    query,
  });
  const nowMs = Date.parse(`${nowMinute}:00Z`);
  const hasProjects = projects.some((project) => project.archivedAt == null);

  const openThread = (thread: EnvironmentThreadShell) =>
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
    });
  const startThread = (project: EnvironmentProject) =>
    void handleNewThread(scopeProjectRef(project.environmentId, project.id));

  return (
    <SidebarInset
      {...workspaceAreaProps("dashboard", 1, gt("Dashboard"))}
      role="main"
      className="min-h-0 overflow-hidden overscroll-y-none"
    >
      <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-5 pb-12 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg font-semibold text-foreground">{gt("Dashboard")}</h1>
            {hasProjects ? (
              <div className="w-full sm:w-72">
                <InputGroup>
                  <InputGroupAddon>
                    <SearchIcon aria-hidden />
                  </InputGroupAddon>
                  <InputGroupInput
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    placeholder={gt("Search projects…")}
                    aria-label={gt("Search projects")}
                  />
                </InputGroup>
              </div>
            ) : null}
          </div>
          {summaries.length > 0 ? (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {summaries.map((summary) => (
                <DashboardProjectCard
                  key={`${summary.project.environmentId}:${summary.project.id}`}
                  summary={summary}
                  statusByKey={statusByKey}
                  nowMs={nowMs}
                  onOpenThread={openThread}
                  onNewThread={startThread}
                />
              ))}
            </ul>
          ) : hasProjects ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{gt("No projects match")}</EmptyTitle>
                <EmptyDescription>{gt("Try a different project name or folder.")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : projectsReady ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{gt("No projects yet")}</EmptyTitle>
                <EmptyDescription>{gt("Add a project to see it here.")}</EmptyDescription>
                <div className="mt-5 flex justify-center">
                  <Button size="sm" onClick={() => openCommandPalette({ open: "add-project" })}>
                    <PlusIcon />
                    {gt("Add project")}
                  </Button>
                </div>
              </EmptyHeader>
            </Empty>
          ) : null}
        </div>
      </div>
    </SidebarInset>
  );
}

function DashboardProjectCard(props: {
  summary: DashboardProjectSummary<EnvironmentProject, EnvironmentThreadShell>;
  statusByKey: ReadonlyMap<string, ThreadStatus>;
  nowMs: number;
  onOpenThread: (thread: EnvironmentThreadShell) => void;
  onNewThread: (project: EnvironmentProject) => void;
}) {
  const gt = useGT();
  const { project, runningCount, attentionCount, lastActiveAt, recentThreads } = props.summary;
  const title = project.isScratch ? gt("General") : project.title;
  const parts = [
    runningCount + attentionCount === 0 ? gt("Nothing running") : null,
    runningCount > 0 ? gt("{count} running", { count: runningCount }) : null,
    attentionCount === 1
      ? gt("1 needs you")
      : attentionCount > 1
        ? gt("{count} need you", { count: attentionCount })
        : null,
    lastActiveAt === null
      ? null
      : gt("active {when}", { when: formatRelativeTimeLabel(lastActiveAt, props.nowMs) }),
  ].filter((part) => part !== null);
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground">
      <div className="flex min-w-0 items-start gap-2">
        <ProjectFavicon project={project} className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{parts.join(" · ")}</p>
        </div>
        <Button
          type="button"
          size="xs"
          variant="outline"
          aria-label={gt("New chat in {project}", { project: title })}
          onClick={() => props.onNewThread(project)}
        >
          <SquarePenIcon />
          {gt("New chat")}
        </Button>
      </div>
      {recentThreads.length > 0 ? (
        <ul className="-mx-1 flex flex-col">
          {recentThreads.map((thread) => {
            const key = threadKeyOf(thread);
            const status = props.statusByKey.get(key);
            const activeAt = resolveThreadActivityTimestamp(thread);
            return (
              <li key={key}>
                <button
                  type="button"
                  className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left text-13 outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70"
                  onClick={() => props.onOpenThread(thread)}
                >
                  <span aria-hidden className="w-3 shrink-0 text-center text-muted-foreground/70">
                    #
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {thread.title.replace(/^#+\s*/, "") || thread.title}
                  </span>
                  {status ? <CabinetThreadStatusDot {...status} /> : null}
                  <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
                    {activeAt === null ? null : formatRelativeTimeLabel(activeAt, props.nowMs)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{gt("No chats yet")}</p>
      )}
    </li>
  );
}
