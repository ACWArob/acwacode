import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import {
  BotIcon,
  CheckIcon,
  MicIcon,
  FileEditIcon,
  GlobeIcon,
  ImageIcon,
  PhoneIcon,
  PhoneOffIcon,
  TerminalIcon,
  UsersIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { useProjects, useVisibleThreadShells } from "~/state/entities";
import {
  CALL_AGENTS,
  callAgentKey,
  type CallActivityRow,
  type CallReadiness,
  type VoiceCallPhase,
} from "~/speech/voiceCall.logic";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const STATUS: Record<VoiceCallPhase, string> = {
  off: "Tap Call to talk",
  listening: "Listening…",
  sending: "Sending…",
  waiting: "Thinking…",
  speaking: "Speaking…",
};

const ACTIVITY_ICON = {
  command: TerminalIcon,
  file: FileEditIcon,
  search: GlobeIcon,
  tool: WrenchIcon,
  agent: BotIcon,
  image: ImageIcon,
} as const;

const MAX_THREADS = 40;

/** A phone-sized, full-screen view of a voice call: who is talking and what the agents are doing. */
export function CallScreen(props: {
  readonly threadId: string;
  readonly threadTitle: string;
  readonly phase: VoiceCallPhase;
  readonly council: boolean;
  readonly speaker: string | null;
  readonly readiness: CallReadiness;
  readonly micRecording: boolean;
  readonly micError: string | null;
  readonly level: number;
  readonly heard: string;
  readonly activity: ReadonlyArray<CallActivityRow>;
  readonly onStart: (council: boolean) => void;
  readonly onDoneTalking: () => void;
  readonly onEnd: () => void;
  readonly onClose: () => void;
}) {
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  const ready = props.readiness.kind === "ready";
  const listening = props.phase === "listening";
  const speaking = callAgentKey(props.speaker);
  const active = props.phase !== "off";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <button
          type="button"
          className="min-h-11 min-w-0 flex-1 truncate py-2 text-left font-medium"
          onClick={() => setPicking((open) => !open)}
        >
          {props.threadTitle || "Pick a chat"}
          <span className="ml-2 text-muted-foreground text-xs">Switch</span>
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close call screen"
          onClick={props.onClose}
        >
          <XIcon />
        </Button>
      </header>

      {picking ? (
        <ThreadPicker currentThreadId={props.threadId} onPicked={() => setPicking(false)} />
      ) : (
        <>
          <section className="mx-auto grid w-full max-w-md grid-cols-4 gap-3 px-4 py-6">
            {CALL_AGENTS.map((agent) => (
              <div key={agent.key} className="flex flex-col items-center gap-2">
                <div
                  className={
                    speaking === agent.key
                      ? "flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-primary/30"
                      : "flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground"
                  }
                >
                  {agent.label.slice(0, 1)}
                </div>
                <span className="text-xs">{agent.label}</span>
              </div>
            ))}
          </section>

          <section className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-6 text-center">
            {props.readiness.kind === "setup" ? (
              <>
                <p className="text-sm">Voice needs a one-time setup on this device.</p>
                <Button
                  onClick={() =>
                    void navigate({
                      to: "/settings/voice",
                      hash: "voice-transcription-destination",
                    })
                  }
                >
                  <MicIcon />
                  Set up voice
                </Button>
              </>
            ) : props.readiness.kind === "unavailable" ? (
              <p className="text-destructive text-sm">{props.readiness.reason}</p>
            ) : props.micError ? (
              <p className="text-destructive text-sm">{props.micError}</p>
            ) : (
              <p className="text-muted-foreground text-sm">
                {props.council && active ? "Council · " : ""}
                {listening && !props.micRecording ? "Starting the mic…" : STATUS[props.phase]}
              </p>
            )}
            {listening && props.micRecording ? (
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.round(Math.min(1, props.level) * 100)}%` }}
                />
              </div>
            ) : null}
            {listening && props.heard ? (
              <p className="line-clamp-3 text-sm">{props.heard}</p>
            ) : null}
          </section>

          <section className="mx-auto mt-4 min-h-0 w-full max-w-md flex-1 overflow-y-auto px-4">
            <h2 className="mb-2 font-medium text-muted-foreground text-xs uppercase">
              What they're doing
            </h2>
            {props.activity.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing yet in this chat.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {props.activity.map((row) => {
                  const Icon = ACTIVITY_ICON[row.kind];
                  return (
                    <li key={row.id} className="flex items-start gap-2 text-sm">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 break-words">{row.text}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <footer className="flex justify-center gap-3 border-t px-4 py-4">
        {listening && props.micRecording ? (
          <Button size="xl" onClick={props.onDoneTalking}>
            <CheckIcon />
            Done talking
          </Button>
        ) : null}
        {active ? (
          <Button variant="destructive" size="xl" onClick={props.onEnd}>
            <PhoneOffIcon />
            End
          </Button>
        ) : (
          <>
            <Button size="xl" disabled={!ready} onClick={() => props.onStart(false)}>
              <PhoneIcon />
              Call
            </Button>
            <Button
              variant="outline"
              size="xl"
              disabled={!ready}
              onClick={() => props.onStart(true)}
            >
              <UsersIcon />
              Council
            </Button>
          </>
        )}
      </footer>
    </div>
  );
}

function ThreadPicker(props: { readonly currentThreadId: string; readonly onPicked: () => void }) {
  const navigate = useNavigate();
  const projects = useProjects();
  const threads = useVisibleThreadShells();
  const [query, setQuery] = useState("");
  const projectTitle = new Map(projects.map((project) => [project.id, project.title]));
  const needle = query.trim().toLowerCase();
  const matches = threads
    .filter((thread) => thread.delegatedFrom === null)
    .filter(
      (thread) =>
        needle === "" ||
        thread.title.toLowerCase().includes(needle) ||
        (projectTitle.get(thread.projectId) ?? "").toLowerCase().includes(needle),
    )
    .toSorted((a, b) => (b.latestUserMessageAt ?? "").localeCompare(a.latestUserMessageAt ?? ""))
    .slice(0, MAX_THREADS);

  return (
    <section className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col gap-3 px-4 py-3">
      <Input
        placeholder="Search projects and chats"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
      />
      {matches.length === 0 ? (
        <p className="text-muted-foreground text-sm">No chats match.</p>
      ) : null}
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {matches.map((thread) => (
          <li key={`${thread.environmentId}:${thread.id}`}>
            <button
              type="button"
              className={
                thread.id === props.currentThreadId
                  ? "w-full rounded-md bg-muted px-2 py-2.5 text-left"
                  : "w-full rounded-md px-2 py-2.5 text-left"
              }
              onClick={() => {
                props.onPicked();
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
                });
              }}
            >
              <span className="block truncate text-sm">{thread.title}</span>
              <span className="block truncate text-muted-foreground text-xs">
                {projectTitle.get(thread.projectId) ?? ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
