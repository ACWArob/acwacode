# Agent setup

Copies of the agent configuration acwa desk is tuned for. None of it is required; adjust to your plans.

| File                   | Copy to                                                                          | What it does                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE-full-force.md` | append to `~/.claude/CLAUDE.md`                                                  | Claude Opus leads: model tiers, budget per plan, which agent and skill gets which job, Team mode, brute force, the browser executor. Edit the budget lines to match your subscriptions. |
| `brute-force-SKILL.md` | `~/.claude/skills/brute-force/SKILL.md`, `~/.agents/skills/brute-force/SKILL.md` | "brute force" keeps going until a checkable result passes; "brute force external" may also install outside tools.                                                                       |
| `opencode.json`        | merge into `~/.config/opencode/opencode.json`                                    | Gives OpenCode a Playwright `browser` tool with a signed-in Chrome profile, and caps output tokens so small OpenRouter balances work. Replace `YOU`.                                    |
| `opencode-AGENTS.md`   | `~/.config/opencode/AGENTS.md`                                                   | Makes the open model a browser executor: do the one step the lead gave, report Done / Page now / Needs the lead, never type passwords or solve CAPTCHAs.                                |

The coding skills the full force section names come from [Superpowers](https://github.com/obra/superpowers) (MIT). Copy `systematic-debugging`, `test-driven-development`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review` and `writing-plans` into the same skill folders.

Sign in to your sites once in the Chrome window the browser tool opens; the profile keeps the sessions.
