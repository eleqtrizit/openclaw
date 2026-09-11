import type { ApplicationContext } from "../../app/context.ts";
import { t } from "../../i18n/index.ts";
import type { ChatComposerDisabledBanner } from "./components/chat-composer-types.ts";
import type { ChatModelPickerOption } from "./components/chat-model-picker-options.ts";

type ChatModelSetupState = {
  catalog: boolean;
  connected: boolean;
  agentsLoaded: boolean;
  selectedAgentFound: boolean;
  agentModel?: string | null;
};

export function requiresChatModelSetup(state: ChatModelSetupState): boolean {
  if (state.catalog || !state.connected || !state.agentsLoaded || !state.selectedAgentFound) {
    return false;
  }
  return !state.agentModel?.trim();
}

export function createChatModelSetupBanner(onAction: () => void): ChatComposerDisabledBanner {
  return {
    kind: "composer-replacement",
    text: t("modelSetup.required.body"),
    actionLabel: t("modelSetup.required.action"),
    onAction,
  };
}

export function openModelAccess(context: ApplicationContext, entry?: ChatModelPickerOption) {
  if (entry?.unavailableReason === "missing-agent-auth") {
    context.navigate("model-providers", {
      search: `?provider=${encodeURIComponent(entry.provider)}&credential=${encodeURIComponent(entry.credentialType ?? "")}`,
    });
    return;
  }
  context.navigate("model-setup");
}
