---
name: mock-exam
description: Make a practice exam that looks and feels like the real one, from past exams, a syllabus, lecture notes or a textbook chapter, then grade it with a rubric. Use when the user asks for a mock, practice or sample exam, a draft exam, "imitate this exam", "quiz me like the final", or wants to prep for a test.
---

# Mock exam

Goal: the user walks into the real exam having already sat something that felt the same.

## 1. Learn the target

Ask only for what's missing, in one short question: which course and exam, and what they have (past exams, sample exam, syllabus, notes, slides). Then read everything given.

From past or sample exams, write down the exam's profile:

- Sections, number of questions, points per question, time limit, open or closed book.
- Question types and their share: multiple choice, short answer, long answer or proof, calculation, code tracing, diagram labelling.
- Phrasing habits ("Justify your answer", "Show all work"), typical difficulty, which topics come up again and again.

With no past exam, build the profile from the syllabus and notes: weight topics by lecture time and stated learning goals, and use a common format for that subject. Say that it's a sample in this case, not an imitation.

Show the profile in a few lines before writing the exam.

## 2. Write the exam

- Original questions only. Imitate the style, structure and difficulty; never copy a past question word for word.
- Match the profile: same sections, point split and mix of types. Cover the frequent topics and include one or two the user is likely to neglect.
- Label any topic you included only because you predict it: "(predicted)".
- Every written question gets a rubric whose criteria add up to its points, and a model answer.

## 3. Deliver it

- Default: `study_quiz`, the app's interactive study mode. Multiple choice for objective questions, `short` for 1–3 sentence answers, `long` for essays, proofs and multi-step work, each with its rubric and progressive hints. Put the time limit and instructions in the title. Up to 50 questions per call; split a long exam into its sections.
- If the user wants a paper copy, also give a printable version, with the answer key held back until they ask.
- Don't reveal answers before the user submits.

## 4. Grade it

When answers come back, grade each one strictly against its rubric: points per criterion with one line why. Finish with:

- Score per section and total, with the grade it would get if a scale is known.
- The two or three weakest topics, each with one concrete thing to review.
- An offer: a short follow-up set on just the weak topics, or `concept-diagrams` for any topic that needs a picture.
