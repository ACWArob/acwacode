import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import { type CodexRateLimitSnapshot, codexRateLimitsToLimits } from "./codexUsageLimits.ts";

const UsageWindow = Schema.Struct({
  used_percent: Schema.Number,
  limit_window_seconds: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  reset_at: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});

const UsageResponse = Schema.Struct({
  plan_type: Schema.optionalKey(Schema.NullOr(Schema.String)),
  rate_limit: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        primary_window: Schema.optionalKey(Schema.NullOr(UsageWindow)),
        secondary_window: Schema.optionalKey(Schema.NullOr(UsageWindow)),
      }),
    ),
  ),
});

type UsageWindow = typeof UsageWindow.Type;

const toWindow = (window: UsageWindow | null | undefined) =>
  window
    ? {
        usedPercent: window.used_percent,
        windowDurationMins:
          typeof window.limit_window_seconds === "number"
            ? Math.round(window.limit_window_seconds / 60)
            : null,
        resetsAt: window.reset_at ?? null,
      }
    : null;

/** ChatGPT's usage payload (what Codex's /status reads) as a rate-limit snapshot. */
export function chatGptUsageToSnapshot(usage: typeof UsageResponse.Type): CodexRateLimitSnapshot {
  return {
    planType: usage.plan_type ?? null,
    primary: toWindow(usage.rate_limit?.primary_window),
    secondary: toWindow(usage.rate_limit?.secondary_window),
  };
}

/**
 * Plan windows for a ChatGPT-connected Codex. The Codex probe reports none for token-shared
 * sign-ins, so read them from the same ChatGPT endpoint Codex's /status uses. Null on any failure.
 */
export const chatGptUsageLimits = Effect.fn("chatGptUsageLimits")(
  function* (accessToken: string, checkedAt: string, accountId?: string) {
    const http = yield* HttpClient.HttpClient;
    const response = yield* http.execute(
      HttpClientRequest.get("https://chatgpt.com/backend-api/wham/usage").pipe(
        HttpClientRequest.bearerToken(accessToken),
        HttpClientRequest.setHeader("Accept", "application/json"),
        accountId
          ? HttpClientRequest.setHeader("ChatGPT-Account-Id", accountId)
          : (request) => request,
      ),
    );
    if (response.status !== 200) return null;
    const usage = yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(UsageResponse)),
    );
    const limits = codexRateLimitsToLimits({ snapshot: chatGptUsageToSnapshot(usage), checkedAt });
    return limits.windows.length > 0 ? limits : null;
  },
  Effect.timeout("10 seconds"),
  Effect.orElseSucceed(() => null),
);

const CodexCliAuth = Schema.Struct({
  tokens: Schema.Struct({
    access_token: Schema.NonEmptyString,
    account_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
});

/**
 * ChatGPT answers the usage request for the Codex CLI's own sign-in but not for a token-shared
 * one, so fall back to the CLI's auth.json on this machine when there is one. Null otherwise.
 */
export const codexCliUsageLimits = Effect.fn("codexCliUsageLimits")(
  function* (authJsonPath: string, checkedAt: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const auth = yield* fileSystem
      .readFileString(authJsonPath)
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(CodexCliAuth))));
    return yield* chatGptUsageLimits(
      auth.tokens.access_token,
      checkedAt,
      auth.tokens.account_id ?? undefined,
    );
  },
  Effect.orElseSucceed(() => null),
);
