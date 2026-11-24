import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import { CheckIcon, ListChecksIcon, ShuffleIcon, UsersIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { AppModelOption } from "../../modelSelection";
import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { getDisplayModelName } from "./providerIconUtils";

const MODELS_PER_AGENT = 4;

/** The "Replying to …" label, as a menu that switches the channel's agent or calls a council. */
export function ComposerAgentPicker(props: {
  readonly children: ReactNode;
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  readonly pick: ModelSelection | null;
  readonly onPick: (pick: ModelSelection | null) => void;
  readonly onEveryone: () => void;
  readonly onTeam: () => void;
}) {
  const agents = props.entries
    .filter((entry) => entry.isAvailable)
    .map((entry) => ({
      entry,
      models: (props.modelOptionsByInstance.get(entry.instanceId) ?? []).slice(0, MODELS_PER_AGENT),
    }))
    .filter((agent) => agent.models.length > 0);
  const picked = (instanceId: ProviderInstanceId, model: string) =>
    props.pick?.instanceId === instanceId && props.pick.model === model;

  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            className="flex min-w-0 items-center rounded-sm hover:underline"
            aria-label="Choose who answers"
          />
        }
      >
        {props.children}
      </MenuTrigger>
      <MenuPopup align="start" side="top">
        <MenuItem onClick={() => props.onPick(null)}>
          <ShuffleIcon />
          <span className="flex-1">Auto (picks per message)</span>
          {props.pick === null ? <CheckIcon /> : null}
        </MenuItem>
        <MenuItem onClick={props.onEveryone}>
          <UsersIcon />
          <span className="flex-1">Everyone (they discuss, Claude sums up)</span>
        </MenuItem>
        <MenuItem onClick={props.onTeam}>
          <ListChecksIcon />
          <span className="flex-1">Team (plan the task, split the work, start it)</span>
        </MenuItem>
        {agents.map((agent) => (
          <MenuGroup key={agent.entry.instanceId}>
            <MenuSeparator />
            <MenuGroupLabel>{agent.entry.displayName}</MenuGroupLabel>
            {agent.models.map((model) => (
              <MenuItem
                key={model.slug}
                onClick={() =>
                  props.onPick({ instanceId: agent.entry.instanceId, model: model.slug })
                }
              >
                <span className="flex-1">{getDisplayModelName(model)}</span>
                {picked(agent.entry.instanceId, model.slug) ? <CheckIcon /> : null}
              </MenuItem>
            ))}
          </MenuGroup>
        ))}
      </MenuPopup>
    </Menu>
  );
}
