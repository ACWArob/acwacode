import { resolveInlineCodeFileLinkMeta, resolveMarkdownFileLinkMeta } from "../../markdown-links";

const VISUAL_EXTENSION = /\.(pdf|html?|svg|png|jpe?g|gif|webp)$/i;
const MARKDOWN_LINK = /\]\(\s*<?([^)\s>]+)>?\s*(?:"[^"]*")?\)/g;
const INLINE_CODE = /`([^`\n]+)`/g;

/** The last file a reply points at that is worth seeing: a PDF, a page or an image. */
export function latestVisualOutputPath(text: string, cwd: string | undefined): string | null {
  const candidates = [
    ...Array.from(text.matchAll(MARKDOWN_LINK), (match) => ({
      index: match.index,
      path: resolveMarkdownFileLinkMeta(match[1], cwd)?.filePath,
    })),
    ...Array.from(text.matchAll(INLINE_CODE), (match) => ({
      index: match.index,
      path: resolveInlineCodeFileLinkMeta(match[1]!, cwd)?.filePath,
    })),
  ];
  const visual = candidates
    .filter((candidate) => candidate.path !== undefined && VISUAL_EXTENSION.test(candidate.path))
    .toSorted((a, b) => a.index - b.index)
    .at(-1);
  return visual?.path ?? null;
}

/**
 * The file to show beside the chat when the newest reply has just finished and names one.
 * Only the newest reply counts, so older messages loading in never open anything.
 */
export function visualOutputToOpen(
  messages: ReadonlyArray<{
    readonly id: string;
    readonly role: string;
    readonly text: string;
    readonly streaming: boolean;
  }>,
  handled: ReadonlySet<string>,
  cwd: string | undefined,
): { readonly messageId: string; readonly path: string } | null {
  const reply = messages.findLast((message) => message.role === "assistant");
  if (!reply || reply.streaming || handled.has(reply.id)) return null;
  const path = latestVisualOutputPath(reply.text, cwd);
  return path === null ? null : { messageId: reply.id, path };
}
