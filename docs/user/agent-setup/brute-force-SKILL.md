---
name: brute-force
description: Use when the user says "brute force" or "brute force external" (or "keep going until it works") about a task. Keep attacking the task until it verifiably works and never stop at "I can't". Plain "brute force" (internal) uses only what is already set up; "brute force external" may also find and install outside tools.
---

# Brute force

The user wants the result, not a report on why it is hard. Treat "I can't" as a hypothesis to disprove. Keep going.

There are two modes:

- **Internal ("brute force"), the default:** use only the agents, tools and skills already set up here (section 3).
- **External ("brute force external"):** everything in internal mode, plus outside tools (section 3b).

## 1. Pin down "done"

Write one line that defines success and how to check it with something that can't lie: a test passes, a command exits 0, a page shows the value, a file exists, the form is submitted. If the user didn't say, pick the most reasonable check and state it.

## 2. Loop until the check passes

Each round:

1. Pick the most promising untried approach.
2. Do it.
3. Run the check.
4. Add one line to your attempt log: the approach, the result, and why it failed.

Never repeat a failed approach unchanged. Change one thing each round: the method, the tool, the agent, the model, the order of steps, or the inputs.

Don't end your turn while the check is failing. Every 5 rounds, post a one-line status ("5 tries, closest: X, trying Y next") and keep going without waiting for a reply.

## 3. When stuck, rotate through what you already have

In internal mode, use only the agents, tools and skills already set up here: don't search GitHub or the web for new tools, and don't install new software. In both modes, rotate through:

- **Another agent.** Hand a sub-part to Codex (Sol) or Gemini with `delegate_task`, or run 2–3 different attempts in parallel and keep the one that works.
- **Another tool you already have.** A script instead of clicking, the browser instead of the command line (or the reverse), a different skill.
- **Smaller pieces.** Split the task, get the easiest piece working, and build up from there.
- **Different inputs.** Other formats, file paths, settings, or the accounts the user is already signed into.
- **Root cause.** If something fails the same way twice, use the systematic-debugging skill before trying more fixes.
- **Re-read the task.** Check the actual error text, logs and docs already on this machine. The answer is often there.

## 3b. External mode only: outside tools

After the internal options stop making progress (or straight away, if the task clearly needs a tool you don't have):

- Search GitHub and the web for a library, CLI, script or skill that already solves this. Prefer well-maintained, widely used projects.
- Read its README and any script before running it. Install it into the project or a temporary folder, not system-wide, unless the user said otherwise.
- Note what you installed in your attempt log and in your final summary, so the user can remove it.

## 4. Limits that brute force does not lift

- Never type passwords or 2FA codes, or solve CAPTCHAs. Ask the user to do that one step, then continue.
- Never use GPT Astra or Claude Fable, or spend OpenRouter credits, without the user's OK.
- Never delete or overwrite the user's files to get past an error. Make copies.
- Ask before anything irreversible (payments, sending messages, submitting for the user, deleting data), unless the user already approved it for this task.

## 5. Stopping

Stop only when:

- the check passes: show the evidence; or
- a limit from section 4 needs the user: say exactly what you need, and continue as soon as they answer.

There is no attempt cap. Running out of new ideas means rotating to the next agent or tool in section 3 and trying again from a different angle, not stopping.
