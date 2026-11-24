import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pinnedThreadCards } from "./pinnedThreads.logic";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const group = (name: string, refs: ReadonlyArray<[EnvironmentId, string]>) => ({
  name,
  memberProjectRefs: refs.map(([environmentId, projectId]) => ({ environmentId, projectId })),
});
const thread = (id: string, environmentId: EnvironmentId, projectId: string) => ({
  id,
  environmentId,
  projectId,
});

describe("pinnedThreadCards", () => {
  it("keeps pin order across projects and pairs each thread with its project", () => {
    const app = group("app", [
      [local, "app"],
      [remote, "app-remote"],
    ]);
    const docs = group("docs", [[local, "docs"]]);
    const cards = pinnedThreadCards(
      [app, docs],
      [thread("b", local, "docs"), thread("a", remote, "app-remote"), thread("c", local, "app")],
    );
    expect(cards.map((card) => [card.thread.id, card.group.name])).toEqual([
      ["b", "docs"],
      ["a", "app"],
      ["c", "app"],
    ]);
  });

  it("drops threads whose project is not shown, such as an archived one", () => {
    const cards = pinnedThreadCards(
      [group("app", [[local, "app"]])],
      [thread("a", local, "archived"), thread("b", local, "app")],
    );
    expect(cards.map((card) => card.thread.id)).toEqual(["b"]);
  });
});
