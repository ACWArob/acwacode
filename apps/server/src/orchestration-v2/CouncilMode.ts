import {
  CommandId,
  isProviderAvailable,
  MessageId,
  type ModelSelection,
  type OrchestrationV2Command,
  type ServerProvider,
} from "@t3tools/contracts";
import { Effect } from "effect";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

type MessageDispatch = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;
type MessagePost = Extract<OrchestrationV2Command, { readonly type: "message.post" }>;

// Kept equal to the web composer's group turn text so both clients fold these the same way.
export const COUNCIL_TURN_TEXT =
  "↳ Your turn in the group: do the part of the message above meant for you, if any, and answer building on the earlier replies.";

// Lets any client, including ones without kotrai's agent picker, start a council by message.
const COUNCIL_ON = /^(council|council on|council mode|start council)$/;
const COUNCIL_OFF = /^(solo|council off|stop council|end council)$/;

/** "council" turns the mode on and "solo" turns it off; anything else is an ordinary message. */
export function councilToggle(text: string): "on" | "off" | null {
  const words = text
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "");
  if (COUNCIL_ON.test(words)) return "on";
  if (COUNCIL_OFF.test(words)) return "off";
  return null;
}

/** The mode is whatever the caller's latest "council" or "solo" note set. */
export function councilActive(
  messages: ReadonlyArray<{ readonly role: string; readonly text: string }>,
): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "user") continue;
    const toggle = councilToggle(message.text);
    if (toggle !== null) return toggle === "on";
  }
  return false;
}

// Claude answers last so it can pull the others together.
const COUNCIL_SEATS = [
  { driver: "codex", model: /\bsol\b/i },
  { driver: "antigravity", model: null },
  { driver: "claudeAgent", model: /opus/i },
] as const;

/** One seat per subscription agent that is installed, signed in and ready, Claude last. */
export function councilMembers(providers: ReadonlyArray<ServerProvider>): Array<ModelSelection> {
  return COUNCIL_SEATS.flatMap((seat) => {
    const provider = providers.find(
      (candidate) =>
        candidate.driver === seat.driver &&
        candidate.enabled &&
        candidate.installed &&
        isProviderAvailable(candidate) &&
        candidate.status !== "error" &&
        candidate.status !== "disabled" &&
        candidate.auth.status !== "unauthenticated",
    );
    if (!provider) return [];
    const model =
      (seat.model && provider.models.find((candidate) => seat.model.test(candidate.slug))) ||
      provider.models.find((candidate) => candidate.isDefault) ||
      provider.models[0];
    return model ? [{ instanceId: provider.instanceId, model: model.slug }] : [];
  });
}

/** Only a message the caller typed takes part: not steers, continuations, tasks or group turns. */
function isPlainSend(command: MessageDispatch): boolean {
  return (
    command.guestMessageId === undefined &&
    command.senderThreadId === undefined &&
    command.linkedSender === undefined &&
    command.scheduledTaskId === undefined &&
    command.notification === undefined &&
    command.delegatedCompletion === undefined &&
    command.restartContinuationOfRunId === undefined &&
    command.usageLimitContinuationOfRunId === undefined &&
    command.manualContinuationOfRunId === undefined &&
    command.steerFollowUpOfRunId === undefined &&
    command.usageLimitRecoveryRequestId === undefined &&
    command.deliveryIntent !== "steer" &&
    command.deliveryIntent !== "restart" &&
    command.dispatchMode.type !== "steer_active" &&
    command.dispatchMode.type !== "restart_active" &&
    !command.text.trimStart().startsWith("@") &&
    !command.text.startsWith("↳")
  );
}

export type CouncilPlan =
  | { readonly type: "pass" }
  | { readonly type: "toggle"; readonly note: MessagePost }
  | {
      readonly type: "council";
      readonly main: MessageDispatch;
      readonly followers: ReadonlyArray<MessageDispatch>;
    };

/**
 * "council" and "solo" become notes that switch the mode. While it is on, each message goes to
 * the first agent and queues a turn for every other one, the way an @all message does.
 */
export const planCouncil = Effect.fn("CouncilMode.planCouncil")(function* (
  command: MessageDispatch,
) {
  if (!isPlainSend(command)) return { type: "pass" } satisfies CouncilPlan;
  if (councilToggle(command.text) !== null) {
    const note: MessagePost = {
      type: "message.post",
      createdBy: command.createdBy,
      creationSource: command.creationSource,
      commandId: command.commandId,
      threadId: command.threadId,
      messageId: command.messageId,
      text: command.text,
      attachments: command.attachments,
      ...(command.context ? { context: command.context } : {}),
    };
    return { type: "toggle", note } satisfies CouncilPlan;
  }
  const threads = yield* ThreadManagement.ThreadManagementService;
  const { projection } = yield* threads.getThreadSnapshotWindow(command.threadId, {
    rowLimit: 400,
  });
  if (!councilActive(projection.messages)) return { type: "pass" } satisfies CouncilPlan;
  const members = councilMembers(yield* (yield* ProviderRegistry.ProviderRegistry).getProviders);
  const [first, ...rest] = members;
  if (!first || rest.length === 0) return { type: "pass" } satisfies CouncilPlan;
  const {
    titleSeed: _titleSeed,
    sourcePlanRef: _sourcePlanRef,
    freshContext: _freshContext,
    context: _context,
    ...turn
  } = command;
  return {
    type: "council",
    main: { ...command, modelSelection: first },
    followers: rest.map((modelSelection, index) => ({
      ...turn,
      // Derived ids keep a retried send from queuing the council twice.
      commandId: CommandId.make(`${command.commandId}:council:${index + 1}`),
      messageId: MessageId.make(`${command.messageId}:council:${index + 1}`),
      text: COUNCIL_TURN_TEXT,
      attachments: [],
      modelSelection,
      dispatchMode: { type: "queue_after_active" },
    })),
  } satisfies CouncilPlan;
});

/**
 * Sends a message from a client, applying council mode. Only client sends go through here, so
 * agents, scheduled tasks and replays never start a council.
 */
export const dispatchWithCouncil = Effect.fn("CouncilMode.dispatchWithCouncil")(function* <A, E, R>(
  command: OrchestrationV2Command,
  dispatch: (command: OrchestrationV2Command) => Effect.Effect<A, E, R>,
) {
  if (command.type !== "message.dispatch") return yield* dispatch(command);
  const plan = yield* planCouncil(command);
  if (plan.type === "pass") return yield* dispatch(command);
  if (plan.type === "toggle") return yield* dispatch(plan.note);
  const result = yield* dispatch(plan.main);
  for (const follower of plan.followers) {
    yield* dispatch(follower).pipe(
      Effect.catchCause((cause) => Effect.logWarning("A council turn was not queued.", cause)),
    );
  }
  return result;
});
