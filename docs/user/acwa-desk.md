# acwa desk features

acwa desk is a fork of [nabilcode](https://github.com/latrael/nabilcode) by Nabil (latrael),
itself a fork of T3 Code. This page covers what acwa desk adds on top. Voice calls are in
[Voice input](./voice-input.md#voice-calls), and plan limits are in
[Usage and limits](./usage.md#track-subscription-limits).

## Automatic agent routing

You don't need to `@` an agent. A message without an `@mention` goes to an agent picked from
what it says:

- **Code** goes to Codex: a code block, or words such as _code_, _bug_, _fix_, _error_,
  _refactor_, _test_, _build_, _deploy_, _commit_, or _script_.
- **Research** goes to Gemini (Antigravity): words such as _research_, _latest_, _news_,
  _search_, _look up_, _compare_, _sources_, _paper_, or _summarize_.
- **Anything else** stays with the channel's last agent and model, so follow-ups continue the
  same conversation.
- **A new channel** with no agent yet goes to Claude Opus.

A topic wins over the last agent, so a code question in a Claude conversation goes to Codex. A
message that matches both topics goes to Codex. A topic only routes to an agent that is set up
and available; otherwise the message falls through to the next rule. Code and research go to that
agent's default model.

The composer shows **Replying to** and the agent before you send. Click it to choose:

- **Auto** routes each message as described above.
- **A model** keeps the channel on that model, even for code or research, until you pick another.
- **Everyone** asks every agent in turn. Each one sees the earlier answers, and Claude speaks last
  and sums up what the group decided.
- **Team** is for tasks: each agent weighs in from its role (Codex as engineer, Gemini as
  researcher), then Claude, as the lead, writes the next steps with an owner for each and starts
  them. This needs the Team rule in your full force section below.

An `@mention` in the message always wins, and `@claude @codex` or `@all` asks several agents in
turn.

Press **Note** next to send to post messages to the channel without running any agent. Press it
again to go back to agents. Note mode lasts until you reload.

## Dashboard

The dashboard shows every project at once. Open it with the grid button in the top bar or
**Open dashboard** in the command palette. Each card shows how many chats are running or need
you, when the project was last active, and its three latest chats, with **New chat** to start
another. Projects with work in progress come first, and the search box filters by name or folder.

Above the projects, a now-playing strip shows the chat that just finished (or one still running)
in a large card, next to a row of other running chats and chats that finished in the last hour.
Turn on **Follow finished tasks** in the dashboard header or the command palette, and acwa desk
opens each chat as it finishes, on this device only. It waits while you are typing and switches
at most once every few seconds.

## Full force

In full force, Claude Opus leads: it splits the work and hands parts to other agents in
parallel with the `delegate_task` tool. Agents get this tool only when acwa desk runs them. Each
child appears in its own thread, and the lead reads the results and combines them.

You turn it on and set the rules in your global Claude instructions, `~/.claude/CLAUDE.md`. Add a
section like this and change it to fit your plans:

```markdown
## Full force

When I say "full force", or a task splits cleanly into independent parts, lead instead of
doing everything yourself:

- Split the work and give each part to a child with `delegate_task`. Children don't see this
  conversation, so each `task` must stand on its own. Give code tasks `isolation: "worktree"`.
- Use the paid plans first: Claude for planning and review, Codex for code, Gemini
  (Antigravity) for research. `orchestrator_capabilities` lists the exact providers and models.
- Use OpenRouter open models (DeepSeek, Kimi, Qwen, GLM, MiniMax through OpenCode) only when I
  ask for them.
- Run at most 3 children at once. Start the next part when one finishes.
- If a child stops on a usage limit, reassign its task to another paid agent instead of giving
  up.
- Read each child's result with `task_status` once it finishes, check it, and combine the
  results before you answer.
```

Then ask Opus for "full force" in any channel.

### Skills

Agents work better with skills, folders of instructions they load when a task matches. acwa desk
agents read them from `~/.claude/skills` (Claude), `~/.agents/skills` (Codex and Gemini CLI) and
`~/.gemini/antigravity-cli/skills` (Antigravity). A good starting set for coding is
[Superpowers](https://github.com/obra/superpowers): `systematic-debugging`,
`test-driven-development`, `verification-before-completion`, `requesting-code-review`,
`receiving-code-review` and `writing-plans`. Copy each skill's folder into those directories.

For tasks that must get done, add a `brute-force` skill: it makes the agent define a checkable
"done", then keep rotating approaches, agents and tools you already have until the check passes,
the same idea as the Ralph loop. It doesn't go looking for new outside tools and has no attempt cap. Say "brute force" in a message to use it. It still stops
for passwords, CAPTCHAs, irreversible actions and expensive models, and asks you.

Add lines to your full force section so the lead names the right skill in each delegated task,
and a Team rule for the Team option:

```markdown
- Name the matching skill in every delegated task: bugs use systematic-debugging, new code uses
  test-driven-development, reviews use requesting-code-review, and nothing is "done" before
  verification-before-completion.
- Team mode: when a message starts with "(Team:", each agent gives its view from its role first.
  You speak last as the lead: write numbered next steps, each with an owner and a skill, then
  start them with `delegate_task`.
```

## Open models through OpenCode

To use DeepSeek, Kimi, Qwen, GLM, MiniMax, and other open models with one key:

1. Create an API key at [OpenRouter](https://openrouter.ai).
2. Add **OpenCode** from the ACP Registry in **Settings → Providers**. See
   [ACP providers](./providers-acp.md#add-an-agent).
3. Give OpenCode the key: set `OPENROUTER_API_KEY` in the provider's environment settings, or
   run `opencode auth login` in a server terminal and choose OpenRouter.
4. Pick an OpenCode model from the `@` menu.

OpenRouter bills these models to your OpenRouter account, not to a subscription.

## Phone access

Your Mac runs the server, and your phone connects to it over [Tailscale](https://tailscale.com).
Install Tailscale on both and sign in to the same tailnet. There are two ways to connect.

|                                             | T3 Code mobile app           | Phone browser                        |
| ------------------------------------------- | ---------------------------- | ------------------------------------ |
| Address                                     | `http://<tailscale-ip>:3774` | `https://<machine>.<tailnet>.ts.net` |
| Automatic routing, voice calls, call screen | No                           | Yes                                  |
| Microphone                                  | The app's own dictation      | Needs HTTPS, which this route has    |

### T3 Code mobile app

1. Install T3 Code from the
   [App Store](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) or
   [Google Play](https://play.google.com/store/apps/details?id=com.t3tools.t3code).
2. On the Mac, forward a tailnet port to acwa desk:

   ```bash
   tailscale serve --bg --tcp 3774 tcp://127.0.0.1:3773
   ```

3. Find the Mac's Tailscale address with `tailscale ip -4`.
4. Create a pairing link (see [Pairing links](#pairing-links)), change its address to
   `http://<tailscale-ip>:3774`, and paste it into **Add environment** in the app.

### Phone browser

1. Your tailnet needs MagicDNS and HTTPS certificates turned on; see
   [Tailscale's HTTPS setup](https://tailscale.com/docs/how-to/set-up-https-certificates).
2. On the Mac, publish acwa desk over HTTPS:

   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:3773
   ```

   **Settings → Sharing & access → Tailscale HTTPS** sets up the same route from the app.

3. Create a pairing link (see [Pairing links](#pairing-links)), change its address to
   `https://<machine>.<tailnet>.ts.net`, and open it in Safari or Chrome on the phone.
4. Add the page to your home screen so it opens like an app.

A browser only allows the microphone on HTTPS, so voice input and calls need this route.

### Pairing links

From a checkout of this repository on the Mac, with acwa desk running:

```bash
node apps/server/src/bin.ts pair --ttl 60m
```

It prints a link such as `http://127.0.0.1:3773/pair#token=…`, valid for 60 minutes. Keep
everything from `/pair` on and swap the address in front for your phone route. Each link pairs
one device. A paired device reconnects on its own after that, so you only pair once.

### Turn it off

`tailscale serve status` lists your routes. Remove one with `tailscale serve --tcp=3774 off` or
`tailscale serve --https=443 off`.
Revoke a paired phone in **Settings → Sharing & access**. See
[Manage or revoke access](./remote-access.md#manage-or-revoke-access).

### Troubleshooting

- **The Mac loses internet when Tailscale is on.** Another VPN's DNS can conflict with
  Tailscale's. Run `tailscale set --accept-dns=false` on the Mac. Use the Mac's Tailscale IP
  instead of its MagicDNS name if a name stops resolving.
- **The phone can't connect.** Check that both devices show as connected in Tailscale and that
  acwa desk is running on the Mac.

## Split screen across projects

The board can show chats from other projects next to the current one, each with its own composer.

- **Add one chat.** Choose **Add card → Thread from another project**. Chats are grouped by
  project, and you can search by chat or project name.
- **Open four projects at once.** Choose **Add card → Split across projects**. The board switches
  to 2×2 and fills its empty slots with the latest chat from each of the three most recently
  active other projects. Cards you already placed stay where they are.

A card from another project shows that project's name in its header. Clicking its title, or
**Focus**, opens the chat in its own project, and the board you left keeps its layout. The split
belongs to the current project's board, like any other layout.

## Study mode

Ask an agent to quiz you and it shows the questions in the chat, one at a time. There are four
kinds: flashcards, multiple choice, short written (a sentence or three), and long written (a
paragraph or essay). Ask for a kind by name, or let the agent pick; it prefers written questions
when the topic needs explaining. Written questions have a **Hint** button that reveals one hint at
a time, and **Show answer** for when you give up. **Submit for grading** sends your answer and the
rubric to the same chat as your message, and the agent replies with a score per criterion and one
thing to improve. If the chat has no thread yet, the text lands in the composer for you to send.

## Install as a Mac app

Build acwa desk from this repository and install it like any other app:

1. Install [Vite+](https://viteplus.dev) (`curl -fsSL https://vite.plus | bash`) and Rust from
   [rustup.rs](https://rustup.rs).
2. From the repository root, install dependencies and build the disk image:

   ```bash
   vp i
   vp run dist:desktop:dmg:arm64
   ```

   On an Intel Mac, use `vp run dist:desktop:dmg:x64`. If the build asks for a Rust target, run
   the `rustup target add` command it prints.

3. Open the DMG in `release/` and drag **acwa desk.app** into **Applications**.
4. To start it when you log in, add it in **System Settings → General → Login Items**.

To update, pull the latest changes and repeat steps 2 and 3.

## Import chat history

Turn your Claude, ChatGPT, and Gemini history into Markdown that agents can read:

1. Export your data:
   - **Claude:** Settings → Privacy → Export data.
   - **ChatGPT:** Settings → Data controls → Export data.
   - **Gemini:** [Google Takeout](https://takeout.google.com), **My Activity → Gemini Apps**, with
     JSON as the format.
2. From the repository root, run:

   ```bash
   node scripts/import-chat-exports.ts <export.zip | export folder | file.json> <output folder>
   ```

3. Add the output folder as a project in acwa desk.

The script recognizes each export by its shape, so you can run it on all three into the same
folder. It writes one file per chat into `claude/`, `chatgpt/`, and `gemini/`, named by date and
title. Gemini's export has no conversations, so each prompt and its answer become one file.

## Scheduled tasks

To run a prompt on a schedule, open **Settings → Scheduled tasks**, or ask an agent to schedule
it. Each task runs on the Mac with its project's model and settings. See
[Scheduled tasks](./project-settings.md#scheduled-tasks-on-mobile).
