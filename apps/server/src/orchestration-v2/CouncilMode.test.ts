import { CommandId, MessageId, ServerProvider, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import {
  COUNCIL_TURN_TEXT,
  councilActive,
  councilMembers,
  councilToggle,
  planCouncil,
} from "./CouncilMode.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

const decodeProvider = Schema.decodeSync(ServerProvider);

const provider = (instanceId: string, driver: string, models: ReadonlyArray<string>, extra = {}) =>
  decodeProvider({
    instanceId,
    driver,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-25T00:00:00.000Z",
    models: models.map((slug, index) => ({
      slug,
      name: slug,
      isCustom: false,
      isDefault: index === 0,
      capabilities: null,
    })),
    ...extra,
  });

const providers = [
  provider("claudeAgent", "claudeAgent", ["claude-haiku-5-5", "claude-opus-5-5"]),
  provider("codex", "codex", ["gpt-6-astra", "gpt-6.2-sol"]),
  provider("antigravity", "antigravity", ["antigravity-default"]),
  provider("opencode", "acpRegistry", ["openrouter/deepseek/deepseek-v4.1-flash"]),
];

const send = (text: string, extra = {}) =>
  ({
    type: "message.dispatch",
    commandId: CommandId.make("send-1"),
    threadId: ThreadId.make("thread-1"),
    messageId: MessageId.make("message-1"),
    text,
    attachments: [],
    titleSeed: "seed",
    dispatchMode: { type: "start_immediately" },
    createdBy: "user",
    creationSource: "web",
    ...extra,
  }) as const;

const layer = (messages: ReadonlyArray<{ readonly role: string; readonly text: string }>) =>
  Layer.mergeAll(
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadSnapshotWindow: () => Effect.succeed({ projection: { messages } } as never),
    }),
    Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed(providers) }),
  );

it("reads council and solo as switches and nothing else", () => {
  assert.strictEqual(councilToggle(" Council. "), "on");
  assert.strictEqual(councilToggle("council off"), "off");
  assert.strictEqual(councilToggle("Solo"), "off");
  assert.strictEqual(councilToggle("ask the council about this"), null);
});

it("follows the latest switch the caller sent", () => {
  assert.isTrue(
    councilActive([
      { role: "user", text: "council" },
      { role: "assistant", text: "solo" },
    ]),
  );
  assert.isFalse(
    councilActive([
      { role: "user", text: "council" },
      { role: "user", text: "solo" },
    ]),
  );
  assert.isFalse(councilActive([{ role: "user", text: "hello" }]));
});

it("seats each ready subscription agent with its premier model, Claude last", () => {
  assert.deepStrictEqual(
    councilMembers([
      ...providers,
      provider("antigravity-2", "antigravity", ["x"], { auth: { status: "unauthenticated" } }),
    ]).map((selection) => selection.model),
    ["gpt-6.2-sol", "antigravity-default", "claude-opus-5-5"],
  );
  assert.deepStrictEqual(
    councilMembers([provider("codex", "codex", ["gpt-6.2-sol"], { status: "error" })]),
    [],
  );
});

it.effect("turns council and solo into notes that start no run", () =>
  Effect.gen(function* () {
    const plan = yield* planCouncil(send("council"));
    assert.strictEqual(plan.type, "toggle");
    if (plan.type === "toggle") assert.strictEqual(plan.note.type, "message.post");
  }).pipe(Effect.provide(layer([]))),
);

it.effect("sends each message to every agent while council is on", () =>
  Effect.gen(function* () {
    const plan = yield* planCouncil(send("How should I grip a mug?"));
    if (plan.type !== "council") return assert.fail(`expected a council, got ${plan.type}`);
    assert.strictEqual(plan.main.modelSelection?.model, "gpt-6.2-sol");
    assert.strictEqual(plan.main.text, "How should I grip a mug?");
    assert.deepStrictEqual(
      plan.followers.map((follower) => [
        follower.modelSelection?.model,
        follower.text,
        follower.dispatchMode.type,
        follower.commandId,
        "titleSeed" in follower,
      ]),
      [
        ["antigravity-default", COUNCIL_TURN_TEXT, "queue_after_active", "send-1:council:1", false],
        ["claude-opus-5-5", COUNCIL_TURN_TEXT, "queue_after_active", "send-1:council:2", false],
      ],
    );
  }).pipe(Effect.provide(layer([{ role: "user", text: "council" }]))),
);

it.effect("leaves messages alone when council is off, mentioned or a steer", () =>
  Effect.gen(function* () {
    assert.strictEqual((yield* planCouncil(send("@codex fix it"))).type, "pass");
    assert.strictEqual(
      (yield* planCouncil(
        send("and also", { dispatchMode: { type: "steer_active", targetRunId: "run" } }),
      )).type,
      "pass",
    );
  }).pipe(Effect.provide(layer([{ role: "user", text: "council" }]))),
);

it.effect("does nothing after solo", () =>
  Effect.gen(function* () {
    assert.strictEqual((yield* planCouncil(send("hi"))).type, "pass");
  }).pipe(
    Effect.provide(
      layer([
        { role: "user", text: "council" },
        { role: "user", text: "solo" },
      ]),
    ),
  ),
);
