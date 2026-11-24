---
name: concept-diagrams
description: Draw diagrams that explain a concept, a paper, a method or a system, for research and for studying. Use when the user asks to understand, explain, compare or visualize something, asks for a diagram, concept map or "draw it", or when a picture would make an explanation click.
---

# Concept diagrams

A diagram earns its place when it shows something prose hides: how parts connect, what causes what, what happens in what order, or how options differ. Draw to make one idea obvious, not to decorate.

## 1. Pick the shape from the question

| The user is asking…                   | Draw                                         | Mermaid type                |
| ------------------------------------- | -------------------------------------------- | --------------------------- |
| How does it work? What happens first? | Process / pipeline, left to right            | `flowchart LR`              |
| What is it made of?                   | Hierarchy or parts tree                      | `flowchart TD` or `mindmap` |
| Why does it happen?                   | Cause and effect map, labelled arrows        | `flowchart LR`              |
| Who talks to whom, in what order?     | Sequence                                     | `sequenceDiagram`           |
| What states can it be in?             | State machine                                | `stateDiagram-v2`           |
| How do A and B differ?                | Side-by-side comparison table, not boxes     | Markdown table              |
| How did it develop?                   | Timeline                                     | `timeline`                  |
| How do these ideas relate?            | Concept map: nouns in boxes, verbs on arrows | `flowchart`                 |

For a research paper, usually draw two: the method pipeline (input → each stage → output, with what each stage learns or computes) and a comparison with the prior work it beats.

## 2. Build it well

- One idea per diagram. Over about 12 boxes, split it into an overview and a zoomed-in part.
- Every arrow gets a verb or a quantity ("encodes", "feeds", "10 Hz", "loss ↓"). An unlabelled arrow explains nothing.
- Name boxes with the user's own terms from their notes or the paper, not your synonyms.
- Group related parts in a `subgraph` with a plain title.
- Put the thing the user asked about in the middle or first, and highlight it with one style class.
- Give a one-sentence caption that says what to notice.

## 3. Where to draw

- In chat: a fenced `mermaid` block. The app draws it inline. Use this by default.
- Richer or interactive (sliders, step-through, animation on click): `html_preview` with a small self-contained page.
- Editable, hand-drawn style the user wants to keep or annotate: use the `excalidraw-diagram` skill if it's installed and save a `.excalidraw` file.

## 4. Teach with it

When the user is studying:

1. Show the full diagram with the caption.
2. Explain it in two or three plain sentences, walking the arrows in order.
3. Offer a self-test: the same diagram with two or three labels replaced by `?`, and ask the user to fill them in. Check their answers one at a time.

## Checks before sending

- Does it render? Mermaid labels with parentheses, colons or quotes need `["..."]`.
- Could someone who skipped the reading follow the arrows and say what happens?
- Is anything in it a guess? Mark it "(assumed)" or leave it out.
