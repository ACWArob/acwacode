import { describe, expect, it } from "vite-plus/test";

import type { CabinetThreadStatus } from "../sidebar/cabinetStatus.logic";
import { pickFinishedThreadToFollow } from "./followFinishedTasks.logic";

const previous = (entries: Record<string, CabinetThreadStatus>) => new Map(Object.entries(entries));

describe("pickFinishedThreadToFollow", () => {
  it.each([
    ["done", "idle"],
    ["needs you", "waiting"],
    ["failed", "failed"],
  ] as const)("follows a thread that stops working because it is %s", (_, status) => {
    expect(
      pickFinishedThreadToFollow(previous({ a: "working" }), [{ key: "a", status, at: 1 }]),
    ).toBe("a");
  });

  it("ignores threads still working, already finished, or seen for the first time", () => {
    expect(
      pickFinishedThreadToFollow(previous({ running: "working", settled: "idle" }), [
        { key: "running", status: "working", at: 3 },
        { key: "settled", status: "waiting", at: 2 },
        { key: "new", status: "idle", at: 1 },
      ]),
    ).toBeNull();
  });

  it("picks the most recent when several finish together", () => {
    expect(
      pickFinishedThreadToFollow(previous({ a: "working", b: "working", c: "working" }), [
        { key: "a", status: "idle", at: 10 },
        { key: "b", status: "failed", at: 30 },
        { key: "c", status: "waiting", at: 20 },
      ]),
    ).toBe("b");
  });
});
