import { describe, expect, it } from "vite-plus/test";
import { RunId } from "@t3tools/contracts";

import type { CabinetThreadStatus } from "../sidebar/cabinetStatus.logic";
import { orderDashboardNowPlaying, summarizeDashboardProjects } from "./dashboard.logic";

const project = (id: string, title: string, extra: { archivedAt?: string } = {}) => ({
  id,
  environmentId: "local",
  title,
  workspaceRoot: `/code/${id}`,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

const thread = (
  id: string,
  projectId: string,
  at: string,
  status: CabinetThreadStatus = "idle",
) => ({
  id,
  environmentId: "local",
  projectId,
  latestUserMessageAt: at,
  latestRun: null,
  updatedAt: at,
  status,
});

const summarize = (
  projects: ReadonlyArray<ReturnType<typeof project>>,
  threads: ReadonlyArray<ReturnType<typeof thread>>,
  query = "",
) =>
  summarizeDashboardProjects({
    projects,
    threads,
    statusOf: (entry) => entry.status,
    query,
  });

describe("summarizeDashboardProjects", () => {
  it("puts busy projects first, then the most recently active, and drops archived ones", () => {
    const summaries = summarize(
      [
        project("quiet", "Quiet"),
        project("recent", "Recent"),
        project("busy", "Busy"),
        project("old", "Old", { archivedAt: "2026-02-01T00:00:00.000Z" }),
      ],
      [
        thread("q1", "quiet", "2026-03-01T00:00:00.000Z"),
        thread("r1", "recent", "2026-03-05T00:00:00.000Z"),
        thread("b1", "busy", "2026-02-01T00:00:00.000Z", "waiting"),
        thread("o1", "old", "2026-03-09T00:00:00.000Z", "working"),
      ],
    );
    expect(summaries.map((summary) => summary.project.id)).toEqual(["busy", "recent", "quiet"]);
  });

  it("counts running and attention chats and keeps the three most recent", () => {
    const [summary] = summarize(
      [project("app", "App")],
      [
        thread("a", "app", "2026-03-01T00:00:00.000Z", "working"),
        thread("b", "app", "2026-03-04T00:00:00.000Z", "waiting"),
        thread("c", "app", "2026-03-03T00:00:00.000Z", "failed"),
        thread("d", "app", "2026-03-02T00:00:00.000Z"),
      ],
    );
    expect(summary).toMatchObject({
      runningCount: 1,
      attentionCount: 2,
      lastActiveAt: "2026-03-04T00:00:00.000Z",
    });
    expect(summary?.recentThreads.map((entry) => entry.id)).toEqual(["b", "c", "d"]);
  });

  it("falls back to the project's own update time when it has no chats", () => {
    const [summary] = summarize([project("empty", "Empty")], []);
    expect(summary).toMatchObject({ lastActiveAt: "2026-01-01T00:00:00.000Z", recentThreads: [] });
  });

  it("filters by title or folder, ignoring case and accents", () => {
    const projects = [project("cafe", "Café app"), project("docs", "Docs")];
    expect(summarize(projects, [], "CAFE").map((summary) => summary.project.id)).toEqual(["cafe"]);
    expect(summarize(projects, [], "code/docs").map((summary) => summary.project.id)).toEqual([
      "docs",
    ]);
  });
});

describe("orderDashboardNowPlaying", () => {
  const nowMs = Date.parse("2026-03-01T12:00:00.000Z");
  const minutesAgo = (minutes: number) => new Date(nowMs - minutes * 60_000).toISOString();
  const finished = (id: string, minutes: number, status: CabinetThreadStatus = "idle") => ({
    ...thread(id, "app", minutesAgo(minutes), status),
    latestUserMessageAt: null,
    latestRun: {
      runId: RunId.make(id),
      status: "completed" as const,
      requestedAt: null,
      startedAt: null,
      completedAt: minutesAgo(minutes),
      assistantMessageId: null,
    },
  });
  const order = (
    threads: ReadonlyArray<ReturnType<typeof thread> | ReturnType<typeof finished>>,
  ) => {
    const result = orderDashboardNowPlaying({ threads, statusOf: (entry) => entry.status, nowMs });
    return { current: result.current?.id ?? null, others: result.others.map((entry) => entry.id) };
  };

  it("leads with a fresh finish, then lists running chats before finished ones, newest first", () => {
    expect(
      order([
        thread("run-old", "app", minutesAgo(30), "working"),
        finished("done-old", 40),
        thread("run-new", "app", minutesAgo(5), "working"),
        finished("needs-you", 3, "waiting"),
        finished("failed", 20, "failed"),
      ]),
    ).toEqual({ current: "needs-you", others: ["run-new", "run-old", "failed", "done-old"] });
  });

  it("shows the newest running chat when nothing finished in the last few minutes", () => {
    expect(order([finished("done", 15), thread("run", "app", minutesAgo(50), "working")])).toEqual({
      current: "run",
      others: ["done"],
    });
  });

  it("drops finishes older than an hour and idle chats that never completed a run", () => {
    expect(
      order([finished("stale", 61), thread("empty", "app", minutesAgo(1)), finished("done", 30)]),
    ).toEqual({ current: "done", others: [] });
  });
});
