import { describe, expect, it } from "vite-plus/test";

import { renderStudyQuizHtml, studyQuizProblem } from "./studyQuiz.ts";

const question = {
  prompt: "What does a Kalman filter estimate?",
  options: ["A hidden state", "A loss", "A gradient"],
  answer: 0,
  explanation: "It estimates a hidden state from noisy measurements.",
};

describe("studyQuizProblem", () => {
  it("rejects an answer index outside the options", () => {
    expect(studyQuizProblem({ title: "t", questions: [question] })).toBeNull();
    expect(studyQuizProblem({ title: "t", questions: [{ ...question, answer: 3 }] })).toContain(
      "past its 3 options",
    );
    expect(studyQuizProblem({ title: "t", questions: [{ ...question, answer: -1 }] })).toContain(
      "0-based index",
    );
  });
});

describe("renderStudyQuizHtml", () => {
  it("embeds quiz text so it cannot close the script tag", () => {
    const html = renderStudyQuizHtml({
      title: "t",
      questions: [{ ...question, prompt: "</script><img src=x onerror=alert(1)> & <!--" }],
    });
    const data = html.slice(html.indexOf('id="quiz-data">'), html.indexOf("</script>"));
    expect(data).not.toContain("<img");
    expect(data).not.toContain("<!--");
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    const json = data.slice('id="quiz-data">'.length);
    expect(JSON.parse(json).questions[0].prompt).toBe(
      "</script><img src=x onerror=alert(1)> & <!--",
    );
  });
});
