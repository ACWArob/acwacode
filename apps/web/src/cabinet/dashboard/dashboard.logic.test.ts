import { describe, expect, it } from "vite-plus/test";

import type { CabinetThreadStatus } from "../sidebar/cabinetStatus.logic";
import { summarizeDashboardProjects } from "./dashboard.logic";

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
