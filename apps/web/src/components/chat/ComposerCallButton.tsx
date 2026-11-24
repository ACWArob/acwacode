import { Maximize2Icon, PhoneIcon, PhoneOffIcon, UsersIcon } from "lucide-react";
import type { PointerEvent, ReactNode } from "react";

import type { VoiceCallPhase } from "~/speech/voiceCall.logic";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const keepFocus = (event: PointerEvent) => event.preventDefault();

const STATUS: Record<Exclude<VoiceCallPhase, "off">, string> = {
  listening: "Listening…",
  sending: "Sending…",
  waiting: "Thinking…",
  speaking: "Speaking…",
};

export function ComposerCallButton(props: {
  phase: VoiceCallPhase;
  council: boolean;
  available: boolean;
  onStart(council: boolean): void;
  onEnd(): void;
  onOpenScreen(): void;
  /** A narrow composer shows one button that opens the call screen, which has Call and Team. */
  compact?: boolean;
}) {
  if (props.phase !== "off") {
    return (
      <div className="flex shrink-0 items-center gap-1.5" role="status" aria-live="polite">
        <span className="text-sm text-muted-foreground">
          {props.council ? "Team · " : ""}
          {STATUS[props.phase]}
        </span>
        <Button
          type="button"
          size="sm-pill"
          variant="destructive"
          onPointerDown={keepFocus}
          onClick={props.onEnd}
        >
          <PhoneOffIcon />
          End call
        </Button>
        <CallStartButton
          available
          label="Open the call screen"
          icon={<Maximize2Icon />}
          onClick={props.onOpenScreen}
        />
      </div>
    );
  }
  if (props.compact) {
    return (
      <CallStartButton
        available
        label="Open the call screen"
        icon={<PhoneIcon />}
        onClick={props.onOpenScreen}
      />
    );
  }
  return (
    <>
      <CallStartButton
        available={props.available}
        label="Start a voice call (the best agent for what you say answers)"
        icon={<PhoneIcon />}
        onClick={() => props.onStart(false)}
      />
      <CallStartButton
        available={props.available}
        label="Start a team call (agents plan in the chat, Claude leads and speaks)"
        icon={<UsersIcon />}
        onClick={() => props.onStart(true)}
      />
      <CallStartButton
        available
        label="Open the call screen"
        icon={<Maximize2Icon />}
        onClick={props.onOpenScreen}
      />
    </>
  );
}

function CallStartButton(props: {
  available: boolean;
  label: string;
  icon: ReactNode;
  onClick(): void;
}) {
  const label = props.available ? props.label : "Set up voice input to start a call";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            disabled={!props.available}
            onPointerDown={keepFocus}
            onClick={props.onClick}
            className="shrink-0"
          >
            {props.icon}
          </Button>
        }
      />
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
