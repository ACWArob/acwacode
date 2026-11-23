import { describe, expect, it } from "vite-plus/test";

import {
  conversationFileName,
  conversationMarkdown,
  parseChatExport,
} from "./import-chat-exports.ts";

describe("parseChatExport", () => {
  it("reads a Claude export with content blocks and attachments", () => {
    const [chat] = parseChatExport([
      {
        uuid: "a1b2c3d4-0000",
        name: "Algeria web",
        created_at: "2026-10-01T10:00:00Z",
        updated_at: "2026-10-02T10:00:00Z",
        chat_messages: [
          {
            sender: "human",
            text: "",
            content: [{ type: "text", text: "Build the hero section" }],
            attachments: [{ file_name: "brief.md", extracted_content: "Colors: green" }],
            created_at: "2026-10-01T10:00:00Z",
          },
          { sender: "assistant", text: "Here it is", created_at: "2026-10-01T10:01:00Z" },
        ],
      },
    ]);
    expect(chat?.source).toBe("claude");
    expect(chat?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(chat?.messages[0]?.text).toContain("Build the hero section");
    expect(chat?.messages[0]?.text).toContain("**Attached: brief.md**\n\nColors: green");
    expect(conversationFileName(chat!)).toBe("claude/2026-10-01-algeria-web-a1b2c3d4.md");
    expect(conversationMarkdown(chat!)).toContain("## You\n\nBuild the hero section");
  });

  it("follows the ChatGPT branch the user last saw, not abandoned edits", () => {
    const [chat] = parseChatExport([
      {
        title: "Resume",
        conversation_id: "c-1",
        create_time: 1_760_000_000,
        current_node: "a2",
        mapping: {
          root: { message: null, parent: null },
          u1: { parent: "root", message: { author: { role: "user" }, content: { parts: ["v1"] } } },
          a1: {
            parent: "u1",
            message: { author: { role: "assistant" }, content: { parts: ["old"] } },
          },
          a2: {
            parent: "u1",
            message: { author: { role: "assistant" }, content: { parts: ["kept"] } },
          },
        },
      },
    ]);
    expect(chat?.messages.map((message) => message.text)).toEqual(["v1", "kept"]);
  });

  it("turns Gemini Takeout activity into one-turn chats and ignores other products", () => {
    const chats = parseChatExport([
      {
        header: "Gemini Apps",
        title: "Prompted explain PID control",
        time: "2026-09-01T00:00:00Z",
        safeHtmlItem: [{ html: "<p>P, I &amp; D terms</p>" }],
      },
      { header: "YouTube", title: "Watched a video", time: "2026-09-01T00:00:00Z" },
    ]);
    expect(chats).toHaveLength(1);
    expect(chats[0]?.messages.map((message) => message.text)).toEqual([
      "explain PID control",
      "P, I & D terms",
    ]);
  });
});
