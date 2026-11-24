import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { memo, type MouseEvent as ReactMouseEvent } from "react";

import { Kbd } from "~/components/ui/kbd";
import { cn } from "~/lib/utils";
import { MemoryBadge } from "../memory/MemoryBadge";
import { useThreadProposalCount } from "../memory/useMemoryProposals";
import { CabinetThreadStatusDot, RenameInput, useCabinetThreadStatus } from "./CabinetThreadRow";

/** A pinned thread as a card; takes the same handlers as `CabinetThreadRow`. */
export const CabinetPinnedCard = memo(function CabinetPinnedCard(props: {
  thread: EnvironmentThreadShell;
  projectName: string;
  selected: boolean;
  jumpLabel: string | null;
  parentKey: string;
  renaming: boolean;
  renameLabel: string;
  revealRef?: ((node: HTMLElement, threadKey: string) => (() => void) | undefined) | undefined;
  onNavigate: (threadRef: ScopedThreadRef) => void;
  onContextMenu: (thread: EnvironmentThreadShell, position: { x: number; y: number }) => void;
  onCommitRename: (threadRef: ScopedThreadRef, title: string) => void;
  onCancelRename: () => void;
}) {
  const { thread, selected, jumpLabel, renaming, revealRef } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const threadStatus = useCabinetThreadStatus(thread);
  const proposalCount = useThreadProposalCount(thread.environmentId, thread.id);
  const displayTitle = thread.title.replace(/^#+\s*/, "") || thread.title;
  const cardClass = cn(
    "flex h-full min-h-14 w-full min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 text-left outline-none ring-1 ring-inset focus-visible:ring-ring/70",
    selected
      ? "bg-sidebar-row-selected text-sidebar-foreground ring-sidebar-foreground/12"
      : "bg-sidebar-control-surface ring-sidebar-border hover:bg-sidebar-row-hover",
  );
  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    props.onContextMenu(thread, { x: event.clientX, y: event.clientY });
  };
  const cardRef = (node: HTMLElement | null) =>
    node === null ? undefined : revealRef?.(node, threadKey);
  const footer = (
    <span className="mt-auto flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 flex-1 truncate text-2xs text-sidebar-muted-foreground">
        {props.projectName}
      </span>
      <CabinetThreadStatusDot {...threadStatus} />
      <MemoryBadge count={proposalCount} />
      {jumpLabel ? (
        <Kbd aria-hidden data-jump-hint>
          {jumpLabel}
        </Kbd>
      ) : null}
    </span>
  );
  return (
    <li data-testid="cabinet-pinned-card" data-thread-key={threadKey} className="min-w-0">
      {renaming ? (
        <div ref={cardRef} className={cardClass} onContextMenu={handleContextMenu}>
          <RenameInput
            initialTitle={thread.title}
            label={props.renameLabel}
            onCommit={(title) => props.onCommitRename(threadRef, title)}
            onCancel={props.onCancelRename}
          />
          {footer}
        </div>
      ) : (
        <button
          ref={cardRef}
          type="button"
          data-sidebar-row={threadKey}
          data-sidebar-parent={props.parentKey}
          aria-current={selected ? "page" : undefined}
          className={cardClass}
          onClick={(event) => {
            // A trailing double click is a rename gesture elsewhere; navigate once.
            if (event.detail > 1) return;
            props.onNavigate(threadRef);
          }}
          onContextMenu={handleContextMenu}
        >
          <span
            className={cn(
              "line-clamp-2 text-13 leading-snug break-words",
              selected || threadStatus.unread
                ? "font-semibold text-sidebar-foreground"
                : "text-sidebar-foreground/85",
            )}
          >
            {displayTitle}
          </span>
          {footer}
        </button>
      )}
    </li>
  );
});
