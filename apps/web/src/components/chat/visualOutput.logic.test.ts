import { describe, expect, it } from "vite-plus/test";

import { latestVisualOutputPath, visualOutputToOpen } from "./visualOutput.logic";

const cwd = "/Users/me/code/app";

describe("latestVisualOutputPath", () => {
  it("finds the last PDF, page or image a reply links to", () => {
    expect(
      latestVisualOutputPath(
        "Made [the chart](out/chart.png) and [the report](/Users/me/code/app/out/report.pdf).",
        cwd,
      ),
    ).toBe("/Users/me/code/app/out/report.pdf");
    expect(latestVisualOutputPath("Open `site/index.html` to see it.", cwd)).toContain(
      "site/index.html",
    );
  });

  it("ignores code and other files", () => {
    expect(latestVisualOutputPath("Edited [main](src/main.ts) and `notes.md`.", cwd)).toBeNull();
  });
});

describe("visualOutputToOpen", () => {
  const reply = (id: string, text: string, streaming = false) =>
    ({ id, role: "assistant", text, streaming }) as const;

  it("opens the newest finished reply's file once", () => {
    const messages = [reply("a1", "Here: [old](old.pdf)"), reply("a2", "Done: [deck](deck.pdf)")];
    expect(visualOutputToOpen(messages, new Set(), cwd)?.messageId).toBe("a2");
    expect(visualOutputToOpen(messages, new Set(["a2"]), cwd)).toBeNull();
  });

  it("waits for the reply to finish and skips replies without a file", () => {
    expect(visualOutputToOpen([reply("a1", "[x](x.pdf)", true)], new Set(), cwd)).toBeNull();
    expect(visualOutputToOpen([reply("a1", "All done.")], new Set(), cwd)).toBeNull();
  });
});
