#!/usr/bin/env node
// One Markdown file per chat from Claude, ChatGPT or Gemini (Takeout) exports, recognised by shape.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command } from "effect/cli";
import JSZip from "jszip";

export interface ImportedMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string | null;
}

export interface ImportedConversation {
  readonly source: "claude" | "chatgpt" | "gemini";
  readonly id: string;
  readonly title: string;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly messages: ReadonlyArray<ImportedMessage>;
}

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
const epochIso = (value: unknown): string | null =>
  typeof value === "number" && Number.isFinite(value)
    ? DateTime.formatIso(DateTime.makeUnsafe(value * 1000))
    : null;

function claudeMessageText(message: Json): string {
  const parts = Array.isArray(message.content)
    ? message.content.flatMap((part) =>
        isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [],
      )
    : [];
  const body = parts.length > 0 ? parts.join("\n\n") : (str(message.text) ?? "");
  const attachments = Array.isArray(message.attachments)
    ? message.attachments.flatMap((attachment) => {
        if (!isRecord(attachment)) return [];
        const name = str(attachment.file_name) ?? "attachment";
        const content = str(attachment.extracted_content);
        return [content ? `**Attached: ${name}**\n\n${content}` : `**Attached: ${name}**`];
      })
    : [];
  return [body, ...attachments].filter((part) => part.trim().length > 0).join("\n\n");
}

function fromClaude(item: Json): ImportedConversation | null {
  if (!Array.isArray(item.chat_messages)) return null;
  const messages = item.chat_messages.flatMap((message): ImportedMessage[] => {
    if (!isRecord(message)) return [];
    const role =
      message.sender === "human" ? "user" : message.sender === "assistant" ? "assistant" : null;
    const text = claudeMessageText(message);
    return role && text.trim() ? [{ role, text, createdAt: str(message.created_at) }] : [];
  });
  return {
    source: "claude",
    id: str(item.uuid) ?? "",
    title: str(item.name) ?? "Untitled Claude chat",
    createdAt: str(item.created_at),
    updatedAt: str(item.updated_at),
    messages,
  };
}

// ChatGPT stores a tree; follow parents from the current node to get the branch the user saw.
function fromChatGpt(item: Json): ImportedConversation | null {
  if (!isRecord(item.mapping)) return null;
  const mapping = item.mapping;
  const chain: Json[] = [];
  let nodeId = str(item.current_node);
  const seen = new Set<string>();
  while (nodeId && !seen.has(nodeId)) {
    seen.add(nodeId);
    const node = mapping[nodeId];
    if (!isRecord(node)) break;
    if (isRecord(node.message)) chain.push(node.message);
    nodeId = str(node.parent);
  }
  const messages = chain.reverse().flatMap((message): ImportedMessage[] => {
    const author = isRecord(message.author) ? message.author.role : null;
    const role = author === "user" ? "user" : author === "assistant" ? "assistant" : null;
    const content = isRecord(message.content) ? message.content : {};
    const text = Array.isArray(content.parts)
      ? content.parts.filter((part): part is string => typeof part === "string").join("\n\n")
      : "";
    return role && text.trim() ? [{ role, text, createdAt: epochIso(message.create_time) }] : [];
  });
  return {
    source: "chatgpt",
    id: str(item.conversation_id) ?? str(item.id) ?? "",
    title: str(item.title) ?? "Untitled ChatGPT chat",
    createdAt: epochIso(item.create_time),
    updatedAt: epochIso(item.update_time),
    messages,
  };
}

const htmlToText = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Takeout activity has no conversations, only prompt/response entries; each becomes a one-turn chat.
function fromGeminiActivity(item: Json): ImportedConversation | null {
  const title = str(item.title);
  if (!title || !/gemini/i.test(str(item.header) ?? "")) return null;
  const prompt = title.replace(/^Prompted\s+/i, "");
  const response = Array.isArray(item.safeHtmlItem)
    ? item.safeHtmlItem
        .flatMap((entry) =>
          isRecord(entry) && typeof entry.html === "string" ? [htmlToText(entry.html)] : [],
        )
        .join("\n\n")
    : "";
  const time = str(item.time);
  const messages: ImportedMessage[] = [{ role: "user", text: prompt, createdAt: time }];
  if (response) messages.push({ role: "assistant", text: response, createdAt: time });
  return {
    source: "gemini",
    id: time ?? prompt.slice(0, 40),
    title: prompt.length > 80 ? `${prompt.slice(0, 77)}…` : prompt,
    createdAt: time,
    updatedAt: time,
    messages,
  };
}

/** Recognises one export file's JSON by shape; unknown shapes return nothing. */
export function parseChatExport(json: unknown): ImportedConversation[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((item) => {
    if (!isRecord(item)) return [];
    const conversation = fromClaude(item) ?? fromChatGpt(item) ?? fromGeminiActivity(item);
    return conversation && conversation.messages.length > 0 ? [conversation] : [];
  });
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "chat";

export function conversationFileName(conversation: ImportedConversation): string {
  const day = (conversation.createdAt ?? "").slice(0, 10) || "undated";
  const id = slug(conversation.id).slice(0, 8);
  return `${conversation.source}/${day}-${slug(conversation.title)}${id ? `-${id}` : ""}.md`;
}

export function conversationMarkdown(conversation: ImportedConversation): string {
  const label = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini" }[conversation.source];
  const header = [
    `# ${conversation.title}`,
    "",
    `- Source: ${label}`,
    ...(conversation.createdAt ? [`- Started: ${conversation.createdAt}`] : []),
    ...(conversation.updatedAt ? [`- Last updated: ${conversation.updatedAt}`] : []),
    "",
  ];
  const body = conversation.messages.flatMap((message) => [
    `## ${message.role === "user" ? "You" : label}`,
    "",
    message.text.trim(),
    "",
  ]);
  return [...header, ...body].join("\n");
}

export class ChatExportZipError extends Schema.TaggedError<ChatExportZipError>()(
  "ChatExportZipError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read ${this.path} as a zip.`;
  }
}

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

const readJsonFiles = Effect.fn("importChatExports.readJsonFiles")(function* (input: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const info = yield* fs.stat(input);
  const parse = (text: string) => decodeJson(text);
  if (info.type === "Directory") {
    const names = (yield* fs.readDirectory(input, { recursive: true })).filter((name) =>
      name.endsWith(".json"),
    );
    return yield* Effect.forEach(names, (name) =>
      fs.readFileString(path.join(input, name)).pipe(Effect.flatMap(parse)),
    );
  }
  if (input.endsWith(".zip")) {
    const zip = yield* fs.readFile(input).pipe(
      Effect.flatMap((bytes) =>
        Effect.tryPromise({
          try: () => JSZip.loadAsync(bytes),
          catch: (cause) => new ChatExportZipError({ path: input, cause }),
        }),
      ),
    );
    const files = Object.values(zip.files).filter(
      (file) => !file.dir && file.name.endsWith(".json"),
    );
    return yield* Effect.forEach(files, (file) =>
      Effect.tryPromise({
        try: () => file.async("string"),
        catch: (cause) => new ChatExportZipError({ path: `${input}/${file.name}`, cause }),
      }).pipe(Effect.flatMap(parse)),
    );
  }
  return [yield* fs.readFileString(input).pipe(Effect.flatMap(parse))];
});

export const importChatExports = Effect.fn("importChatExports")(function* (
  input: string,
  output: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const conversations = (yield* readJsonFiles(input)).flatMap(parseChatExport);
  const counts: Record<string, number> = {};
  for (const conversation of conversations) {
    const file = path.join(output, conversationFileName(conversation));
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFileString(file, conversationMarkdown(conversation));
    counts[conversation.source] = (counts[conversation.source] ?? 0) + 1;
  }
  const summary = Object.entries(counts)
    .map(([source, count]) => `${count} ${source}`)
    .join(", ");
  yield* Console.log(
    conversations.length === 0
      ? "No conversations found in that export."
      : `Wrote ${summary} chats to ${output}`,
  );
});

export const importChatExportsCommand = Command.make(
  "import-chat-exports",
  {
    input: Argument.String("input").pipe(
      Argument.withDescription("Export .zip, unzipped export folder, or a single .json file."),
    ),
    output: Argument.String("output").pipe(
      Argument.withDescription("Folder to write one Markdown file per chat into."),
    ),
  },
  ({ input, output }) => importChatExports(input, output),
).pipe(Command.withDescription("Turn Claude, ChatGPT or Gemini chat exports into Markdown files."));

if (import.meta.main) {
  Command.run(importChatExportsCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
