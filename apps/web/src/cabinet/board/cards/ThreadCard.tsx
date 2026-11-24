import { parseScopedThreadKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react";
import { FileDiffIcon, FolderIcon } from "lucide-react";
import { lazy, Suspense, useState, type ReactNode } from "react";

import { FileSurfaceLoading } from "~/components/files/fileSurfaceChrome";
import { resolveSidebarRowStatus, resolveThreadLastVisitedAt } from "~/components/Sidebar.logic";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { observeIntersection } from "~/lib/observeIntersection";
import { cn } from "~/lib/utils";
import { useProject, useQuietThreadShell } from "~/state/entities";
import { useUiStateStore } from "~/uiStateStore";
import { cabinetRowStatus } from "../../sidebar/cabinetStatus.logic";
import { DOT_CLASS } from "../../sidebar/CabinetThreadRow";
import SecondaryThreadBody from "./SecondaryThreadBody";
import { ThreadHeaderChips } from "./ThreadHeaderChips";
import type { BoardCard as BoardCardModel, BoardSlot } from "../board.types";
import { BoardCard } from "../BoardCard";

// Lazy so the diff viewer loads only once a diff card shows. The thread body is not: revealing a
// suspended tiptap editor tears down its view and crashes the composer (see SideChatPane's mount).
const DiffCard = lazy(() => import("./DiffCard"));

/**
 * A secondary thread card or a diff card; `card.ref` is a scoped thread key. Its body mounts only
 * while the card is on screen, so a card hidden by the narrow-board fallback holds no thread
 * subscriptions. A thread the route already shows renders no second live view. A thread of another
 * project than the board's names its project in the header.
 */
export function ThreadBoardCard(props: {
  readonly card: BoardCardModel;
  readonly slot: BoardSlot;
  readonly active: boolean;
  readonly multi: boolean;
  readonly primaryThreadKey: string;
  /** The board's project; a card whose thread belongs elsewhere is cross-project. */
  readonly boardProject: ScopedProjectRef | null;
  /** `crossProject`: the thread opens in its own project's board, so this board stays as it is. */
  readonly onPromote: (crossProject: boolean) => void;
  readonly onOpenDiff: () => void;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { card } = props;
  const threadKey = card.ref ?? "";
  const threadRef = parseScopedThreadKey(threadKey);
  const shell = useQuietThreadShell(threadRef);
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const [visible, setVisible] = useState(false);
  const isDiff = card.kind === "diff";
  const threadTitle = shell?.title ?? gt("Thread");
  const crossProject =
    shell !== null &&
    props.boardProject !== null &&
    (shell.environmentId !== props.boardProject.environmentId ||
      shell.projectId !== props.boardProject.projectId);
  const projectTitle =
    useProject(crossProject ? scopeProjectRef(shell.environmentId, shell.projectId) : null)
      ?.title ?? null;
  const projectChip = projectTitle === null ? null : <ThreadProjectChip title={projectTitle} />;
  const promote = () => props.onPromote(crossProject);

  let leading = <FileDiffIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
  if (!isDiff) {
    const lastVisitedAt = resolveThreadLastVisitedAt(shell?.lastVisitedAt, localLastVisitedAt);
    const status = shell
      ? cabinetRowStatus(resolveSidebarRowStatus({ ...shell, lastVisitedAt }))
      : null;
    leading = (
      <span
        aria-label={status?.text ? m(status.text) : undefined}
        role={status?.text ? "img" : undefined}
        data-cabinet-status={status?.status ?? "idle"}
        className={cn("size-[7px] shrink-0 rounded-full", DOT_CLASS[status?.status ?? "idle"])}
      />
    );
  }

  let body = null;
  if (threadRef === null) {
    body = null;
  } else if (!isDiff && threadKey === props.primaryThreadKey) {
    body = (
      <p role="status" className="p-3 text-xs text-muted-foreground">
        {gt("This thread is open in the main card.")}
      </p>
    );
  } else if (visible) {
    body = isDiff ? (
      <Suspense fallback={<FileSurfaceLoading />}>
        <DiffCard threadRef={threadRef} />
      </Suspense>
    ) : (
      <SecondaryThreadBody threadRef={threadRef} onOpenDiff={props.onOpenDiff} />
    );
  }

  return (
    <BoardCard
      card={card}
      slot={props.slot}
      active={props.active}
      multi={props.multi}
      title={isDiff ? gt("Diff: {title}", { title: threadTitle }) : threadTitle}
      leading={leading}
      {...(isDiff
        ? { extras: <HeaderChipGroup>{projectChip}</HeaderChipGroup> }
        : {
            extras: (
              <HeaderChipGroup>
                {projectChip}
                {threadRef === null ? null : <ThreadHeaderChips threadRef={threadRef} />}
              </HeaderChipGroup>
            ),
            onActivateTitle: promote,
            titleActionLabel:
              projectTitle === null
                ? gt("Focus this thread")
                : gt("Open in {project}", { project: projectTitle }),
            actions: (
              <>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={gt("Open diff of {title}", { title: threadTitle })}
                  onClick={props.onOpenDiff}
                >
                  <FileDiffIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={gt("Focus {title}", { title: threadTitle })}
                  onClick={promote}
                >
                  <span aria-hidden className="text-2xs">
                    ◇
                  </span>
                </Button>
              </>
            ),
          })}
      onClose={props.onClose}
    >
      <div
        ref={(node) =>
          node === null
            ? undefined
            : observeIntersection(node, (entry) => setVisible(entry.isIntersecting))
        }
        className="flex min-h-0 flex-1 flex-col"
      >
        {body}
      </div>
    </BoardCard>
  );
}

// Chips give way to the title in narrow cards: the group shrinks four times faster than it.
function HeaderChipGroup(props: { readonly children: ReactNode }) {
  return (
    <span className="flex min-w-0 shrink-[4] items-center gap-2 overflow-hidden">
      {props.children}
    </span>
  );
}

function ThreadProjectChip(props: { readonly title: string }) {
  const gt = useGT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-testid="thread-project-chip"
            className="inline-flex h-[18px] max-w-40 min-w-0 shrink items-center gap-1 rounded-sm border border-border px-1.5 text-2xs text-muted-foreground"
          />
        }
      >
        <FolderIcon aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{props.title}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {gt("Project: {project}", { project: props.title })}
      </TooltipPopup>
    </Tooltip>
  );
}
