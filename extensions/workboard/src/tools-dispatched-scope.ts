import type { WorkboardCard } from "@openclaw/workboard-contract";
import type { WorkboardMutationScope } from "./store-inputs.js";

export type DispatchedWorkerBinding = {
  cardId?: string;
  sessionKey?: string;
};

export type WorkboardToolMutationScope = WorkboardMutationScope & {
  ownerId: string;
  token?: string;
};

export function dispatchedMutationScope(
  scope: WorkboardToolMutationScope,
  card: WorkboardCard,
  binding: DispatchedWorkerBinding | undefined,
): WorkboardToolMutationScope {
  if (!binding) {
    return scope;
  }
  return {
    ...scope,
    dispatchedCardId: card.id,
    ...(binding.sessionKey ? { dispatchedSessionKey: binding.sessionKey } : {}),
  };
}
