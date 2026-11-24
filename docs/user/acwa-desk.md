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

The composer shows **Replying to** and the agent before you send, so you can check the pick.
To choose yourself, `@` an agent or a model: an `@mention` always wins, and `@claude @codex` or
`@all` asks several agents in turn.

Press **Note** next to send to post messages to the channel without running any agent. Press it
again to go back to agents. Note mode lasts until you reload.

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
