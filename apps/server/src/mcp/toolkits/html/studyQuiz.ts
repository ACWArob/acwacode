import { HTML_RENDER_SEND_TYPE } from "@t3tools/shared/htmlRender";

export interface StudyChoiceQuestion {
  readonly prompt: string;
  readonly options: ReadonlyArray<string>;
  readonly answer: number;
  readonly explanation: string;
  readonly hint?: string | undefined;
}

export interface StudyRubricCriterion {
  readonly criterion: string;
  readonly points: number;
  readonly earnedBy: string;
}

export interface StudyWrittenQuestion {
  readonly kind: "short" | "long";
  readonly prompt: string;
  readonly rubric: ReadonlyArray<StudyRubricCriterion>;
  readonly hints: ReadonlyArray<string>;
  readonly modelAnswer?: string | undefined;
}

export type StudyQuizQuestion = StudyChoiceQuestion | StudyWrittenQuestion;

export interface StudyQuiz {
  readonly title: string;
  readonly questions: ReadonlyArray<StudyQuizQuestion>;
  readonly view?: "quiz" | "flashcards" | undefined;
}

/** The first problem that makes this quiz unusable, or null. */
export function studyQuizProblem(quiz: StudyQuiz): string | null {
  for (const [index, question] of quiz.questions.entries()) {
    if ("options" in question) {
      if (!Number.isInteger(question.answer) || question.answer < 0) {
        return `Question ${index + 1}: answer must be the 0-based index of the right option.`;
      }
      if (question.answer >= question.options.length) {
        return `Question ${index + 1}: answer ${question.answer} is past its ${question.options.length} options.`;
      }
      continue;
    }
    if (question.rubric.length === 0) {
      return `Question ${index + 1}: a written question needs at least one rubric criterion.`;
    }
    const bad = question.rubric.find((c) => !Number.isFinite(c.points) || c.points <= 0);
    if (bad !== undefined) {
      return `Question ${index + 1}: rubric criterion "${bad.criterion}" must be worth more than 0 points.`;
    }
  }
  return null;
}

/**
 * The message Submit sends for the agent to grade. The page embeds this function's source, so it
 * must stay self-contained: no imports, helpers, or outer variables.
 */
export function studyGradingMessage(
  question: Pick<StudyWrittenQuestion, "prompt" | "rubric">,
  answer: string,
): string {
  const pts = (n: number) => `${n} ${n === 1 ? "pt" : "pts"}`;
  const total = question.rubric.reduce((sum, c) => sum + c.points, 0);
  const rubric = question.rubric.map((c) => `- ${c.criterion} (${pts(c.points)}): ${c.earnedBy}`);
  return [
    `Grade my answer to "${question.prompt}" using the rubric.`,
    "",
    "Rubric:",
    ...rubric,
    "",
    "My answer:",
    answer,
    "",
    `Reply with my score out of ${total}, one line per criterion with the points I earned, one thing to improve, and whether the answer is good enough.`,
  ].join("\n");
}

// JSON inside <script> must not be able to close the tag or open a comment.
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const STYLE = `
.q{font:15px/1.5 var(--font-sans);color:var(--foreground)}
.top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;color:var(--muted-foreground);font-size:13px}
.tabs button,.row button{font:inherit;cursor:pointer;border:1px solid var(--border);background:var(--card);color:var(--foreground);border-radius:var(--radius);padding:6px 12px}
.row button:disabled{cursor:default;opacity:.55}
.tabs button[aria-pressed=true]{border-color:var(--primary);color:var(--primary)}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
.prompt{font-weight:600;margin:0 0 12px;white-space:pre-wrap}
.opts{display:grid;gap:8px}
.opt{display:flex;gap:10px;text-align:left;width:100%;font:inherit;cursor:pointer;border:1px solid var(--border);background:var(--background);color:var(--foreground);border-radius:var(--radius);padding:10px 12px}
.opt:hover:not(:disabled){border-color:var(--primary)}
.opt:disabled{cursor:default}
.opt .k{color:var(--muted-foreground);min-width:1.2em}
.opt.right{border-color:var(--success);background:color-mix(in srgb,var(--success) 14%,transparent)}
.opt.wrong{border-color:var(--destructive);background:color-mix(in srgb,var(--destructive) 12%,transparent)}
.fb{margin-top:12px;white-space:pre-wrap}
.fb b.ok{color:var(--success)} .fb b.no{color:var(--destructive)}
.hint{margin-top:10px;color:var(--muted-foreground);white-space:pre-wrap}
.row{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
.row .primary{background:var(--primary);color:var(--primary-foreground);border-color:var(--primary)}
.score{font-size:22px;font-weight:700;margin:0 0 6px}
.flip{cursor:pointer;min-height:120px;display:flex;align-items:center;justify-content:center;text-align:center;white-space:pre-wrap}
.pts{color:var(--muted-foreground);font-weight:400;font-size:13px}
.bubble{display:block;box-sizing:border-box;width:100%;font:inherit;color:var(--foreground);background:var(--background);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px}
.bubble:focus{border-color:var(--primary);outline:none}
textarea.bubble{min-height:180px;resize:vertical}
.reveal{margin-top:12px;padding-top:12px;border-top:1px solid var(--border);white-space:pre-wrap}
.reveal b{display:block;margin-top:10px} .reveal b:first-child{margin-top:0}
.reveal ul{margin:6px 0 0;padding-left:20px}
`;

// Plain DOM, no dependencies: the page runs inside the html_render frame.
const SCRIPT = `
const quiz = JSON.parse(document.getElementById("quiz-data").textContent);
const SEND = ${JSON.stringify(HTML_RENDER_SEND_TYPE)};
const gradingMessage = ${studyGradingMessage.toString()};
const root = document.getElementById("quiz");
const keys = "ABCDEFGH";
const written = (q) => !Array.isArray(q.options);
const total = (q) => q.rubric.reduce((sum, c) => sum + c.points, 0);
const pts = (n) => n + (n === 1 ? " pt" : " pts");
let mode = quiz.view === "flashcards" ? "cards" : "quiz", order = quiz.questions.map((_, i) => i), pos = 0, picked = null, showHint = false, missed = [], correct = 0, flipped = false;
const drafts = {}, hintsShown = {}, sent = {}, revealed = {};
const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === "on") n.addEventListener("click", v); else if (k === "text") n.textContent = v; else n.setAttribute(k, v); } for (const c of kids) if (c) n.append(c); return n; };
function restart(list) { order = list; pos = 0; picked = null; showHint = false; missed = []; correct = 0; flipped = false; render(); }
function next() { pos += 1; picked = null; showHint = false; render(); }
function writtenCard(index, q) {
  const card = el("div", { class: "card" }, el("p", { class: "prompt" }, document.createTextNode(q.prompt + " "), el("span", { class: "pts", text: "(" + pts(total(q)) + ")" })));
  const box = q.kind === "long" ? el("textarea", { class: "bubble", rows: "8", maxlength: "8000", placeholder: "Write your answer" }) : el("input", { class: "bubble", type: "text", maxlength: "1000", placeholder: "Answer in 1 to 3 sentences" });
  box.value = drafts[index] || "";
  if (sent[index]) box.readOnly = true;
  card.append(box);
  const shown = hintsShown[index] || 0;
  for (let h = 0; h < shown; h++) card.append(el("div", { class: "hint", text: "Hint " + (h + 1) + ": " + q.hints[h] }));
  const row = el("div", { class: "row" });
  if (!sent[index] && shown < q.hints.length) row.append(el("button", { text: shown ? "Next hint" : "Hint", on: () => { hintsShown[index] = shown + 1; render(); } }));
  const submit = el("button", { class: "primary", text: sent[index] ? "Sent for grading" : "Submit for grading", on: () => {
    const answer = (drafts[index] || "").trim();
    if (!answer || sent[index]) return;
    sent[index] = true;
    if (window.parent !== window) window.parent.postMessage({ type: SEND, text: gradingMessage(q, answer) }, "*");
    render();
  } });
  submit.disabled = sent[index] || !(drafts[index] || "").trim();
  box.addEventListener("input", () => { drafts[index] = box.value; submit.disabled = sent[index] || !box.value.trim(); });
  row.append(submit);
  if (!revealed[index]) row.append(el("button", { text: "Show answer", on: () => { revealed[index] = true; render(); } }));
  row.append(el("button", { text: pos + 1 < order.length ? "Next question" : "See score", on: next }));
  card.append(row);
  if (sent[index]) card.append(el("div", { class: "hint", text: "Sent to the chat. The grade arrives as a reply." }));
  if (revealed[index]) {
    const reveal = el("div", { class: "reveal" });
    if (q.modelAnswer) reveal.append(el("b", { text: "Model answer" }), el("div", { text: q.modelAnswer }));
    reveal.append(el("b", { text: "Rubric" }), el("ul", {}, ...q.rubric.map((c) => el("li", { text: c.criterion + " (" + pts(c.points) + "): " + c.earnedBy }))));
    card.append(reveal);
  }
  return card;
}
function cardBack(q) {
  if (!written(q)) return keys[q.answer] + ". " + q.options[q.answer] + "\\n\\n" + q.explanation;
  return (q.modelAnswer ? q.modelAnswer + "\\n\\n" : "") + q.rubric.map((c) => c.criterion + " (" + pts(c.points) + ")").join("\\n");
}
function render() {
  root.replaceChildren();
  const tabs = el("div", { class: "tabs row" },
    el("button", { "aria-pressed": String(mode === "quiz"), text: "Quiz", on: () => { mode = "quiz"; restart(order); } }),
    el("button", { "aria-pressed": String(mode === "cards"), text: "Flashcards", on: () => { mode = "cards"; restart(quiz.questions.map((_, i) => i)); } }));
  if (pos >= order.length) {
    root.append(el("div", { class: "top" }, el("span", { text: quiz.title }), tabs));
    const choices = order.filter((i) => !written(quiz.questions[i])).length;
    const graded = order.filter((i) => sent[i]).length;
    const card = el("div", { class: "card" });
    if (choices) card.append(el("p", { class: "score", text: correct + " / " + choices }),
      el("div", { text: missed.length ? "Missed: " + missed.map((i) => "Q" + (i + 1)).join(", ") : "Every one right." }));
    if (choices < order.length) card.append(el("div", { text: graded + " of " + (order.length - choices) + " written answers sent for grading." }));
    const row = el("div", { class: "row" });
    if (missed.length) row.append(el("button", { class: "primary", text: "Retry missed", on: () => restart(missed.slice()) }));
    row.append(el("button", { text: "Start over", on: () => restart(quiz.questions.map((_, i) => i)) }));
    card.append(row); root.append(card); return;
  }
  const index = order[pos], q = quiz.questions[index];
  root.append(el("div", { class: "top" }, el("span", { text: quiz.title + " · " + (pos + 1) + " of " + order.length }), tabs));
  if (mode === "cards") {
    const card = el("div", { class: "card flip", text: flipped ? cardBack(q) : q.prompt, on: () => { flipped = !flipped; render(); } });
    root.append(card, el("div", { class: "row" },
      el("button", { text: "Previous", on: () => { pos = Math.max(0, pos - 1); flipped = false; render(); } }),
      el("button", { class: "primary", text: pos + 1 < order.length ? "Next" : "Done", on: () => { pos += 1; flipped = false; render(); } })));
    return;
  }
  if (written(q)) { root.append(writtenCard(index, q)); return; }
  const card = el("div", { class: "card" }, el("p", { class: "prompt", text: q.prompt }));
  const opts = el("div", { class: "opts" });
  q.options.forEach((text, i) => {
    const cls = picked === null ? "opt" : i === q.answer ? "opt right" : i === picked ? "opt wrong" : "opt";
    const b = el("button", { class: cls, on: () => { if (picked !== null) return; picked = i; if (i === q.answer) correct += 1; else missed.push(index); render(); } }, el("span", { class: "k", text: keys[i] }), el("span", { text }));
    if (picked !== null) b.disabled = true;
    opts.append(b);
  });
  card.append(opts);
  if (picked === null && q.hint) {
    if (showHint) card.append(el("div", { class: "hint", text: "Hint: " + q.hint }));
    else card.append(el("div", { class: "row" }, el("button", { text: "Show hint", on: () => { showHint = true; render(); } })));
  }
  if (picked !== null) {
    const ok = picked === q.answer;
    card.append(el("div", { class: "fb" }, el("b", { class: ok ? "ok" : "no", text: ok ? "Right. " : "Not quite. The answer is " + keys[q.answer] + ". " }), document.createTextNode(q.explanation)));
    card.append(el("div", { class: "row" }, el("button", { class: "primary", text: pos + 1 < order.length ? "Next question" : "See score", on: next })));
  }
  root.append(card);
}
render();
`;

export function renderStudyQuizHtml(quiz: StudyQuiz): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<style>${STYLE}</style></head><body>`,
    '<div id="quiz" class="q"></div>',
    `<script type="application/json" id="quiz-data">${scriptJson(quiz)}</script>`,
    `<script>${SCRIPT}</script>`,
    "</body></html>",
  ].join("");
}
