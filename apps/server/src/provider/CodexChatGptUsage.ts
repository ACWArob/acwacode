import * as Effect from "effect/Effect";
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
  function* (accessToken: string, checkedAt: string) {
    const http = yield* HttpClient.HttpClient;
    const response = yield* http.execute(
      HttpClientRequest.get("https://chatgpt.com/backend-api/wham/usage").pipe(
        HttpClientRequest.bearerToken(accessToken),
        HttpClientRequest.setHeader("Accept", "application/json"),
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
