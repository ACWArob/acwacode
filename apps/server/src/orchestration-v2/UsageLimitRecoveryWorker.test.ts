import { assert, describe, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ModelSelection,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as UsageLimitRecoveryWorker from "./UsageLimitRecoveryWorker.ts";
import { limitRecoveryCommand } from "./UsageLimitRecoveryWorker.ts";

it.effect("idle sweeps skip SQL until the next wake time or a relevant event", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-07-01T09:00:00.000Z"));
    const startMs = Date.parse("2026-07-01T09:00:00.000Z");
    const queries = yield* Queue.unbounded<number>();
    const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
    const layer = UsageLimitRecoveryWorker.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Scheduler.layer,
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getLimitRecoveryCandidates: () =>
              Clock.currentTimeMillis.pipe(
                Effect.flatMap((nowMs) => Queue.offer(queries, nowMs - startMs)),
                Effect.as([]),
              ),
            // One armed thread resets at 60s.
            getLimitRecoveryWakeAt: (now) =>
              Effect.succeed(
                DateTime.toEpochMillis(now) < startMs + 60_000 ? startMs + 60_000 : null,
              ),
          }),
          Layer.mock(ThreadManagement.ThreadManagementService)({}),
          Layer.mock(Orchestrator.OrchestratorV2)({
            streamDomainEvents: Stream.fromQueue(events),
          }),
          Layer.mock(ServerSettings.ServerSettingsService)({
            getSettings: Effect.succeed({
              autoResumeLimitedThreads: true,
              snoozeLimitedThreads: false,
            } as never),
            streamChanges: Stream.never,
          }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      assert.equal(yield* Queue.take(queries), 0);
      // Eleven idle ticks before the recorded wake time, then the wake tick itself.
      yield* TestClock.adjust("60 seconds");
      assert.equal(yield* Queue.take(queries), 60_000);
      yield* Queue.offer(events, {
        type: "turn-item.updated",
        payload: { type: "assistant_message" },
      } as never);
      yield* TestClock.adjust("30 seconds");
      yield* Queue.offer(events, { type: "run.updated", payload: { status: "failed" } } as never);
      yield* TestClock.adjust("5 seconds");
      // A streaming item at 90s does not wake it; the failed run does on the 95s tick.
      assert.equal(yield* Queue.take(queries), 95_000);
    }).pipe(Effect.provide(layer));
  }),
);

const HOUR_MS = 60 * 60 * 1000;
const nowMs = Date.parse("2026-10-19T12:00:00.000Z");

const failedThread = (failedAgoMs: number, resetAgoMs: number) => {
  const failedAt = DateTime.makeUnsafe(nowMs - failedAgoMs);
  const candidate: ProjectionStore.ProjectionLimitRecoveryCandidate = {
    id: ThreadId.make("thread:limited"),
    status: "failed",
    lastErrorClass: "usage_limit",
    usageLimitResetAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs - resetAgoMs)),
    latestRunId: RunId.make("run:limited"),
    latestRunCompletedAt: failedAt,
    updatedAt: failedAt,
    archivedAt: null,
    settledOverride: null,
    pendingRuntimeRequest: null,
    limitRecovery: null,
    snoozedUntil: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    latestRunProviderInstanceId: ProviderInstanceId.make("codex"),
  };
  return candidate;
};

describe("limitRecoveryCommand arming", () => {
  it("does not freshly arm a failure whose reset passed days ago", () => {
    const thread = failedThread(5 * 24 * HOUR_MS, 4 * 24 * HOUR_MS);
    assert.isNull(limitRecoveryCommand(thread, true, nowMs));
    assert.isNull(limitRecoveryCommand(thread, true, nowMs, true));
  });

  it("still arms a failure whose reset only just passed", () => {
    const thread = failedThread(6 * HOUR_MS, HOUR_MS);
    const arm = limitRecoveryCommand(thread, true, nowMs);
    assert.equal(arm?.type, "thread.metadata.update");
  });

  it("arms a reset that is exactly 24 hours overdue", () => {
    const thread = failedThread(30 * HOUR_MS, 24 * HOUR_MS);
    const arm = limitRecoveryCommand(thread, true, nowMs);
    assert.equal(arm?.type, "thread.metadata.update");
  });

  it("does not arm a reset that is 24 hours and 1ms overdue", () => {
    const thread = failedThread(30 * HOUR_MS, 24 * HOUR_MS + 1);
    assert.isNull(limitRecoveryCommand(thread, true, nowMs));
  });
});

describe("limitRecoveryCommand model switch", () => {
  const backup: ModelSelection = {
    instanceId: ProviderInstanceId.make("claude"),
    model: "claude-sonnet-4-5",
  };
  // Failed ten minutes ago; the limit resets in an hour.
  const limited = () => failedThread(10 * 60 * 1000, -HOUR_MS);

  it("continues on the backup now, even over an armed resume", () => {
    const thread = limited();
    const armed = {
      ...thread,
      limitRecovery: {
        runId: thread.latestRunId!,
        resetAt: thread.usageLimitResetAt!,
        autoResume: true,
      },
    };
    for (const candidate of [thread, armed]) {
      assert.deepEqual(limitRecoveryCommand(candidate, true, nowMs, true, backup), {
        type: "message.dispatch",
        commandId: "limit-switch:thread:limited:run:limited",
        messageId: "limit-switch:thread:limited:run:limited",
        threadId: thread.id,
        usageLimitContinuationOfRunId: thread.latestRunId!,
        modelSelection: backup,
        text: "Continue where you left off. (The previous agent hit its usage limit, so this is continuing on claude-sonnet-4-5.)",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "agent",
        creationSource: "server",
      } as never);
    }
  });

  it("keys the command to the failed run so later sweeps cannot send twice", () => {
    const first = limitRecoveryCommand(limited(), false, nowMs, false, backup);
    const later = limitRecoveryCommand(limited(), false, nowMs + 60_000, false, backup);
    assert.equal(later?.commandId, first?.commandId);
    assert(first?.type === "message.dispatch" && later?.type === "message.dispatch");
    assert.equal(later.messageId, first.messageId);
    const nextRun = limitRecoveryCommand(
      { ...limited(), latestRunId: RunId.make("run:next") },
      false,
      nowMs,
      false,
      backup,
    );
    assert.notEqual(nextRun?.commandId, first.commandId);
  });

  it.each([
    ["the setting is off", limited(), null],
    [
      "the failed run already used the backup",
      { ...limited(), latestRunProviderInstanceId: backup.instanceId },
      backup,
    ],
    [
      "the user picked another model since",
      { ...limited(), providerInstanceId: ProviderInstanceId.make("gemini") },
      backup,
    ],
    [
      "the thread is snoozed",
      { ...limited(), snoozedUntil: DateTime.makeUnsafe(nowMs + 60_000) },
      backup,
    ],
    ["the thread is archived", { ...limited(), archivedAt: DateTime.makeUnsafe(nowMs) }, backup],
    ["the thread is settled", { ...limited(), settledOverride: "settled" as const }, backup],
    ["a request is pending", { ...limited(), pendingRuntimeRequest: {} as never }, backup],
    ["the limit already reset", failedThread(2 * HOUR_MS, HOUR_MS), backup],
    ["the failure is over a day old", failedThread(24 * HOUR_MS + 1, -HOUR_MS), backup],
  ])("does not switch when %s", (_, thread, switchTo) => {
    const command = limitRecoveryCommand(thread, false, nowMs, false, switchTo);
    assert.notEqual(command?.type, "message.dispatch");
  });

  it("arms resume-at-reset as before when it does not switch", () => {
    const thread = { ...limited(), latestRunProviderInstanceId: backup.instanceId };
    assert.equal(
      limitRecoveryCommand(thread, true, nowMs, false, backup)?.type,
      "thread.metadata.update",
    );
  });
});
