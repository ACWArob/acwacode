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
import { useGT, useMessages } from "gt-react";
import { PlusIcon, SearchIcon, SquarePenIcon } from "lucide-react";
import { useState } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { ProjectFavicon } from "~/components/ProjectFavicon";
import { filterSidebarV2VisibleThreads } from "~/components/Sidebar.logic";
import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { SidebarInset } from "~/components/ui/sidebar";
import { Switch } from "~/components/ui/switch";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
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
import {
  orderDashboardNowPlaying,
  summarizeDashboardProjects,
  type DashboardProjectSummary,
} from "./dashboard.logic";
import { useFollowFinishedTasks } from "./followFinishedTasks";

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
  const [followFinished, setFollowFinished] = useFollowFinishedTasks();

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
  const nowPlaying = orderDashboardNowPlaying({
    threads: listed,
    statusOf: (thread) => statusByKey.get(threadKeyOf(thread))?.status ?? "idle",
    nowMs,
  });
  const projectTitleByKey = new Map(
    projects.map((project) => [
      `${project.environmentId}:${project.id}`,
      project.isScratch ? gt("General") : project.title,
    ]),
  );
  const nowPlayingCard = (thread: EnvironmentThreadShell, size: "large" | "small") => {
    const key = threadKeyOf(thread);
    return (
      <NowPlayingCard
        key={key}
        thread={thread}
        size={size}
        projectTitle={projectTitleByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? ""}
        status={statusByKey.get(key)}
        nowMs={nowMs}
        onOpen={openThread}
      />
    );
  };
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
            <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  size="sm"
                  checked={followFinished}
                  onCheckedChange={(checked) => setFollowFinished(checked)}
                />
                {gt("Follow finished tasks")}
              </label>
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
          </div>
          {nowPlaying.current ? (
            <section
              aria-label={gt("Now playing")}
              className="flex min-w-0 flex-col gap-3 md:flex-row"
            >
              <div className="w-full shrink-0 md:w-80">
                {nowPlayingCard(nowPlaying.current, "large")}
              </div>
              {nowPlaying.others.length > 0 ? (
                <ul className="flex min-w-0 flex-1 snap-x snap-proximity [overflow-anchor:none] gap-3 overflow-x-auto overscroll-x-contain pb-1">
                  {nowPlaying.others.map((thread) => (
                    <li key={threadKeyOf(thread)} className="w-52 shrink-0 snap-start">
                      {nowPlayingCard(thread, "small")}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
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

function NowPlayingCard(props: {
  thread: EnvironmentThreadShell;
  size: "large" | "small";
  projectTitle: string;
  status: ThreadStatus | undefined;
  nowMs: number;
  onOpen: (thread: EnvironmentThreadShell) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { thread, size, status } = props;
  const large = size === "large";
  const activeAt = resolveThreadActivityTimestamp(thread);
  const statusText = status?.text ? m(status.text) : gt("done");
  return (
    <button
      type="button"
      className={cn(
        "flex h-full w-full min-w-0 flex-col gap-1 rounded-lg border border-border bg-card text-left text-card-foreground outline-none transition-transform duration-150 hover:bg-accent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70 active:scale-[0.98]",
        large ? "p-4" : "p-3",
      )}
      onClick={() => props.onOpen(thread)}
    >
      <span className="truncate text-2xs text-muted-foreground">{props.projectTitle}</span>
      <span className={cn("min-w-0 truncate font-semibold", large ? "text-base" : "text-13")}>
        {thread.title.replace(/^#+\s*/, "") || thread.title}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {status ? <CabinetThreadStatusDot {...status} /> : null}
        <span className="truncate">
          {activeAt === null
            ? statusText
            : `${statusText} · ${formatRelativeTimeLabel(activeAt, props.nowMs)}`}
        </span>
      </span>
    </button>
  );
}
