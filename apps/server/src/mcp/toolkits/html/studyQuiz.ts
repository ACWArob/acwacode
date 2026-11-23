export interface StudyQuizQuestion {
  readonly prompt: string;
  readonly options: ReadonlyArray<string>;
  readonly answer: number;
  readonly explanation: string;
  readonly hint?: string | undefined;
}

export interface StudyQuiz {
  readonly title: string;
  readonly questions: ReadonlyArray<StudyQuizQuestion>;
}

/** The first problem that makes this quiz unusable, or null. */
export function studyQuizProblem(quiz: StudyQuiz): string | null {
  for (const [index, question] of quiz.questions.entries()) {
    if (!Number.isInteger(question.answer) || question.answer < 0) {
      return `Question ${index + 1}: answer must be the 0-based index of the right option.`;
    }
    if (question.answer >= question.options.length) {
      return `Question ${index + 1}: answer ${question.answer} is past its ${question.options.length} options.`;
    }
  }
  return null;
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
`;

// Plain DOM, no dependencies: the page runs inside the html_render frame.
const SCRIPT = `
const quiz = JSON.parse(document.getElementById("quiz-data").textContent);
const root = document.getElementById("quiz");
const keys = "ABCDEFGH";
let mode = "quiz", order = quiz.questions.map((_, i) => i), pos = 0, picked = null, showHint = false, missed = [], correct = 0, flipped = false;
const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === "on") n.addEventListener("click", v); else if (k === "text") n.textContent = v; else n.setAttribute(k, v); } for (const c of kids) if (c) n.append(c); return n; };
function restart(list) { order = list; pos = 0; picked = null; showHint = false; missed = []; correct = 0; flipped = false; render(); }
function render() {
  root.replaceChildren();
  const tabs = el("div", { class: "tabs row" },
    el("button", { "aria-pressed": String(mode === "quiz"), text: "Quiz", on: () => { mode = "quiz"; restart(order); } }),
    el("button", { "aria-pressed": String(mode === "cards"), text: "Flashcards", on: () => { mode = "cards"; restart(quiz.questions.map((_, i) => i)); } }));
  if (pos >= order.length) {
    root.append(el("div", { class: "top" }, el("span", { text: quiz.title }), tabs));
    const card = el("div", { class: "card" }, el("p", { class: "score", text: correct + " / " + order.length }),
      el("div", { text: missed.length ? "Missed: " + missed.map((i) => "Q" + (i + 1)).join(", ") : "Every one right." }));
    const row = el("div", { class: "row" });
    if (missed.length) row.append(el("button", { class: "primary", text: "Retry missed", on: () => restart(missed.slice()) }));
    row.append(el("button", { text: "Start over", on: () => restart(quiz.questions.map((_, i) => i)) }));
    card.append(row); root.append(card); return;
  }
  const index = order[pos], q = quiz.questions[index];
  root.append(el("div", { class: "top" }, el("span", { text: quiz.title + " · " + (pos + 1) + " of " + order.length }), tabs));
  if (mode === "cards") {
    const card = el("div", { class: "card flip", text: flipped ? keys[q.answer] + ". " + q.options[q.answer] + "\\n\\n" + q.explanation : q.prompt, on: () => { flipped = !flipped; render(); } });
    root.append(card, el("div", { class: "row" },
      el("button", { text: "Previous", on: () => { pos = Math.max(0, pos - 1); flipped = false; render(); } }),
      el("button", { class: "primary", text: pos + 1 < order.length ? "Next" : "Done", on: () => { pos += 1; flipped = false; render(); } })));
    return;
  }
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
    card.append(el("div", { class: "row" }, el("button", { class: "primary", text: pos + 1 < order.length ? "Next question" : "See score", on: () => { pos += 1; picked = null; showHint = false; render(); } })));
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
