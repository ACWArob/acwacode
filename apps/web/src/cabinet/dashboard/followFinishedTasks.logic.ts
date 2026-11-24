import type { CabinetThreadStatus } from "../sidebar/cabinetStatus.logic";

export interface FollowThreadObservation {
  readonly key: string;
  readonly status: CabinetThreadStatus;
  /** Last activity in ms, so the newest wins when several finish in one update. */
  readonly at: number;
}

/**
 * The thread to show after a status update: the newest one that went from working to done,
 * needs-you or failed. A thread missing from `previous` was just seen, so it never counts.
 */
export function pickFinishedThreadToFollow(
  previous: ReadonlyMap<string, CabinetThreadStatus>,
  next: ReadonlyArray<FollowThreadObservation>,
): string | null {
  let picked: FollowThreadObservation | null = null;
  for (const observation of next) {
    if (observation.status === "working" || previous.get(observation.key) !== "working") continue;
    if (
      picked === null ||
      observation.at > picked.at ||
      (observation.at === picked.at && observation.key < picked.key)
    ) {
      picked = observation;
    }
  }
  return picked?.key ?? null;
}
