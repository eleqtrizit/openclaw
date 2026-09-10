import type { WorkboardCard } from "@openclaw/workboard-contract";
import { safeEqualSecret } from "openclaw/plugin-sdk/security-runtime";
import { normalizeOptionalString } from "openclaw/plugin-sdk/string-coerce-runtime";
import { cardSessionKey } from "./store-card-helpers.js";
import type { WorkboardMutationScope } from "./store-inputs.js";

export function assertDispatchedMutationScope(
  card: WorkboardCard,
  scope: WorkboardMutationScope | undefined,
) {
  if (!scope) {
    return;
  }
  const dispatchedCardId = normalizeOptionalString(scope.dispatchedCardId);
  if (!dispatchedCardId) {
    return;
  }
  const isAssignedCard = card.id === dispatchedCardId;
  if (!isAssignedCard) {
    throw new Error("dispatched Workboard workers may mutate only their assigned card.");
  }
  const dispatchedSessionKey = normalizeOptionalString(scope.dispatchedSessionKey);
  if (!dispatchedSessionKey) {
    return;
  }
  const currentSessionKey = cardSessionKey(card);
  if (
    !currentSessionKey ||
    (currentSessionKey !== dispatchedSessionKey &&
      !(
        currentSessionKey.startsWith("subagent:workboard-") &&
        dispatchedSessionKey.endsWith(`:${currentSessionKey}`)
      ))
  ) {
    throw new Error("dispatched Workboard worker is no longer assigned to this card.");
  }
}

export function assertCanMutateClaimedCard(
  card: WorkboardCard,
  scope: WorkboardMutationScope | undefined,
) {
  assertDispatchedMutationScope(card, scope);
  if (!scope) {
    return;
  }
  const claim = card.metadata?.claim;
  if (!claim) {
    return;
  }
  const ownerId = normalizeOptionalString(scope.ownerId);
  const token = normalizeOptionalString(scope.token);
  if (claim.ownerId !== ownerId && !safeEqualSecret(token, claim.token)) {
    throw new Error(`card is claimed by ${claim.ownerId}.`);
  }
}
