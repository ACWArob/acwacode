import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  HTML_RENDER_COLUMN_WIDTH,
  HTML_RENDER_LAYOUT_GUIDE,
  HTML_RENDER_MAX_FIT_HEIGHT,
  HTML_RENDER_MAX_HEIGHT,
  HTML_RENDER_MAX_TITLE_LENGTH,
  HTML_RENDER_MIN_HEIGHT,
  HTML_RENDER_THEME_GUIDE,
  HTML_RENDER_TOOL_NAME,
} from "@t3tools/shared/htmlRender";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const Html = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512_000)).annotate({
  description: "Inline HTML.",
});

const HtmlPath = Schema.String.annotate({
  description: "Absolute .html file path.",
});

const PAGE_RULES =
  "Self-contained: inline <style> and <script>. Local images as absolute paths are inlined. Remote URLs load as-is.";

export const HtmlPreviewTool = Tool.make("html_preview", {
  description: `Check an HTML page before html_render. Returns PNG, contentHeight, and console output. ${PAGE_RULES} Theme and layout rules are in html_render.`,
  parameters: Schema.Struct({
    path: Schema.optional(HtmlPath),
    html: Schema.optional(Html),
    width: Schema.optional(
      Schema.Int.annotate({
        description: `CSS pixels, 240 to 1600. Default ${HTML_RENDER_COLUMN_WIDTH}. Use about 390 for phones.`,
      }),
    ),
    appearance: Schema.optional(
      Schema.Literals(["dark", "light"]).annotate({
        description: "Default dark.",
      }),
    ),
  }),
  success: Schema.Struct({
    width: Schema.Int,
    contentHeight: Schema.Int,
    capturedHeight: Schema.Int,
    consoleMessages: Schema.Array(
      Schema.Struct({
        level: Schema.Literals(["log", "info", "warning", "error"]),
        text: Schema.String,
      }),
    ),
    missingImages: Schema.optional(Schema.Array(Schema.String)),
    screenshot: Schema.Struct({
      mimeType: Schema.Literal("image/png"),
      data: Schema.String,
      width: Schema.Int,
      height: Schema.Int,
    }),
  }),
  failure: OrchestratorMcpFailure,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    HtmlRender.HtmlRender,
  ],
})
  .annotate(Tool.Title, "Preview HTML")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

// This affects only the caller's thread, not its workspace, so read-only sandboxes and plan mode may use it.
const HtmlRenderTool = Tool.make(HTML_RENDER_TOOL_NAME, {
  description: `Show a finished HTML page (chart, diagram, mockup) inline in this thread, above your final reply. Do not announce or restate the page. Frame fits height to ${HTML_RENDER_MAX_FIT_HEIGHT}px. On mobile, content past the given height scrolls. ${HTML_RENDER_LAYOUT_GUIDE} ${HTML_RENDER_THEME_GUIDE}`,
  parameters: Schema.Struct({
    path: Schema.optional(HtmlPath),
    html: Schema.optional(Html),
    title: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(HTML_RENDER_MAX_TITLE_LENGTH),
    ),
    height: Schema.Int.annotate({
      description: `Frame height in CSS pixels, ${HTML_RENDER_MIN_HEIGHT} to ${HTML_RENDER_MAX_HEIGHT}. Use the contentHeight from html_preview.`,
    }),
  }),
  success: Schema.Struct({
    htmlRender: Schema.Struct({
      attachmentId: Schema.String,
      title: Schema.String,
      height: Schema.Number,
      heights: Schema.optional(Schema.Array(Schema.Tuple([Schema.Int, Schema.Int]))),
    }),
    message: Schema.String,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    HtmlRender.HtmlRender,
  ],
})
  .annotate(Tool.Title, "Render HTML")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const StudyChoiceQuestion = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_000)),
  options: Schema.Array(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1_000)),
  ).check(Schema.isMinLength(2), Schema.isMaxLength(8)),
  answer: Schema.Int.annotate({ description: "0-based index of the right option." }),
  explanation: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_000)).annotate({
    description: "Why the right option is right, in plain words. Shown after the user answers.",
  }),
  hint: Schema.optional(
    Schema.String.check(Schema.isMaxLength(1_000)).annotate({
      description: "A nudge that does not give the answer away.",
    }),
  ),
});

const StudyWrittenQuestion = Schema.Struct({
  kind: Schema.Literals(["short", "long"]).annotate({
    description:
      "short: one-line box, 1-3 sentence answer, 1-3 criteria. long: tall box, paragraph or essay, 3-6 criteria.",
  }),
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_000)),
  rubric: Schema.Array(
    Schema.Struct({
      criterion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
      points: Schema.Int.annotate({ description: "Positive." }),
      earnedBy: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1_000)).annotate({
        description: "What the answer must show to earn these points.",
      }),
    }),
  ).check(Schema.isMaxLength(8)),
  hints: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1_000)))
    .check(Schema.isMinLength(1), Schema.isMaxLength(3))
    .annotate({ description: "Progressive nudges, vaguest first. None gives the answer away." }),
  modelAnswer: Schema.optional(
    Schema.String.check(Schema.isMaxLength(8_000)).annotate({
      description: "Shown only when the user asks for the answer.",
    }),
  ),
});

const StudyQuizTool = Tool.make("study_quiz", {
  description:
    "Show interactive study questions inline in this thread, one at a time. Four kinds: flashcards (view: flashcards), multiple choice (instant right/wrong with your explanation), short written (1-3 sentences, small rubric), and long written (paragraph or essay, bigger rubric). Written questions have progressive hints and a model answer; Submit sends the answer to you to grade against the rubric. Kinds can mix in one call. Use when the user asks for a quiz, flashcards, or practice. Use the kind they ask for; when practice needs explanation, prefer written questions with rubrics. Do not restate the questions in your reply.",
  parameters: Schema.Struct({
    title: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(HTML_RENDER_MAX_TITLE_LENGTH),
    ),
    questions: Schema.Array(Schema.Union([StudyChoiceQuestion, StudyWrittenQuestion])).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(50),
    ),
    view: Schema.optional(
      Schema.Literals(["quiz", "flashcards"]).annotate({
        description: "First view. Default quiz.",
      }),
    ),
  }),
  success: Schema.Struct({
    htmlRender: Schema.Struct({
      attachmentId: Schema.String,
      title: Schema.String,
      height: Schema.Number,
      heights: Schema.optional(Schema.Array(Schema.Tuple([Schema.Int, Schema.Int]))),
    }),
    message: Schema.String,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    HtmlRender.HtmlRender,
  ],
})
  .annotate(Tool.Title, "Study quiz")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const HtmlPreviewToolkit = Toolkit.make(HtmlPreviewTool);

export const HtmlRenderToolkit = Toolkit.make(HtmlRenderTool, StudyQuizTool);

export const HtmlToolkit = Toolkit.make(HtmlPreviewTool, HtmlRenderTool, StudyQuizTool);
