import { describe, expect, it } from "vite-plus/test";

import {
  renderStudyQuizHtml,
  studyGradingMessage,
  studyQuizProblem,
  type StudyWrittenQuestion,
} from "./studyQuiz.ts";

const written: StudyWrittenQuestion = {
  kind: "long",
  prompt: "Why does a Kalman filter need a motion model?",
  rubric: [
    { criterion: "Prediction", points: 2, earnedBy: "Says the model predicts the next state." },
    { criterion: "Fusion", points: 1, earnedBy: "Says the prediction is fused with measurements." },
  ],
  hints: ["Think about what happens between measurements.", "What gets compared to the sensor?"],
  modelAnswer: "It predicts the state forward so each measurement can correct a prior.",
};

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

  it("rejects a written question without criteria or with non-positive points", () => {
    expect(studyQuizProblem({ title: "t", questions: [question, written] })).toBeNull();
    expect(studyQuizProblem({ title: "t", questions: [{ ...written, rubric: [] }] })).toContain(
      "at least one rubric criterion",
    );
    for (const points of [0, -2]) {
      const rubric = [written.rubric[0]!, { ...written.rubric[1]!, points }];
      expect(studyQuizProblem({ title: "t", questions: [question, { ...written, rubric }] })).toBe(
        'Question 2: rubric criterion "Fusion" must be worth more than 0 points.',
      );
    }
  });
});

describe("studyGradingMessage", () => {
  it("lists the rubric and answer and asks for a score out of the total", () => {
    expect(studyGradingMessage(written, "It predicts.")).toBe(
      [
        'Grade my answer to "Why does a Kalman filter need a motion model?" using the rubric.',
        "",
        "Rubric:",
        "- Prediction (2 pts): Says the model predicts the next state.",
        "- Fusion (1 pt): Says the prediction is fused with measurements.",
        "",
        "My answer:",
        "It predicts.",
        "",
        "Reply with my score out of 3, one line per criterion with the points I earned, one thing to improve, and whether the answer is good enough.",
      ].join("\n"),
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

  it("embeds written questions, the first view, and a working grading message builder", () => {
    const html = renderStudyQuizHtml({
      title: "t",
      questions: [question, written],
      view: "flashcards",
    });
    const data = html.slice(html.indexOf('id="quiz-data">') + 'id="quiz-data">'.length);
    const quiz = JSON.parse(data.slice(0, data.indexOf("</script>")));
    expect(quiz.view).toBe("flashcards");
    expect(quiz.questions[1]).toEqual(written);
    expect(html).toContain('const SEND = "t3:html-render-send";');
    // The page runs this source on its own, so it must not depend on module scope.
    const source = studyGradingMessage.toString();
    expect(html).toContain(`const gradingMessage = ${source};`);
    const embedded = new Function(`return ${source}`)() as typeof studyGradingMessage;
    expect(embedded(written, "It predicts.")).toBe(studyGradingMessage(written, "It predicts."));
  });
});
