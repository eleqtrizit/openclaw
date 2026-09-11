import { definePage, type RouteLoaderOptions, type RouteLocation } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";
import type { ApplicationContext } from "../../app/context.ts";
import { normalizeAgentId } from "../../lib/sessions/session-key.ts";
import type { ModelProvidersData } from "./load.ts";

export type ModelProvidersRouteData = {
  /** Gateway source that owned the route preload. */
  gateway: ApplicationContext["gateway"];
  /** Exact Gateway snapshot captured before the preload began. */
  gatewaySnapshot: ApplicationContext["gateway"]["snapshot"];
  data: ModelProvidersData;
  /** Client the loader fetched from; null when it ran disconnected. */
  client: ApplicationContext["gateway"]["snapshot"]["client"];
  /** Concrete agent whose credential store populated the auth snapshot. */
  agentId: string | null;
  /** Provider targeted by a model-picker access action. */
  focusProvider?: string | null;
  /** Credential family behind the targeted access action. */
  focusCredential?: "api-key" | "oauth" | "token" | "subscription" | null;
};

async function loadModelProvidersRouteData(
  context: ApplicationContext,
  options: RouteLoaderOptions,
): Promise<ModelProvidersRouteData> {
  const gateway = context.gateway;
  const gatewaySnapshot = gateway.snapshot;
  const search = new URLSearchParams(options.location.search);
  const focusProvider = search.get("provider");
  const rawFocusCredential = search.get("credential");
  const focusCredential =
    rawFocusCredential === "api-key" ||
    rawFocusCredential === "oauth" ||
    rawFocusCredential === "token" ||
    rawFocusCredential === "subscription"
      ? rawFocusCredential
      : null;
  let agentId = context.agentSelection.state.selectedId;
  const { EMPTY_MODEL_PROVIDERS_DATA, loadModelProvidersData } = await import("./load.ts");
  const client = gatewaySnapshot.phase === "connected" ? gatewaySnapshot.client : null;
  // Both awaits can outlive the route or its Gateway/agent owner. Metadata-only
  // snapshot publications preserve the client and hello, so remain valid.
  const isCurrent = () => {
    const current = gateway.snapshot;
    return (
      options.shouldRun() &&
      current.phase === "connected" &&
      current.client === gatewaySnapshot.client &&
      current.hello === gatewaySnapshot.hello &&
      context.agentSelection.state.selectedId === agentId
    );
  };
  if (!client || !isCurrent()) {
    return {
      gateway,
      gatewaySnapshot,
      data: EMPTY_MODEL_PROVIDERS_DATA,
      client: null,
      agentId,
      focusProvider,
      focusCredential,
    };
  }
  if (!agentId) {
    const roster = await context.agents.ensureList();
    // The roster may initialize selection; never adopt an unrelated user switch.
    agentId = roster ? normalizeAgentId(roster.defaultId) : null;
  }
  if (!agentId || !isCurrent()) {
    return {
      gateway,
      gatewaySnapshot,
      data: EMPTY_MODEL_PROVIDERS_DATA,
      client: null,
      agentId,
      focusProvider,
      focusCredential,
    };
  }
  return {
    gateway,
    gatewaySnapshot,
    data: await loadModelProvidersData(client, { agentId, signal: options.signal }),
    client,
    agentId,
    focusProvider,
    focusCredential,
  };
}

export const page = definePage({
  ...routePageSpec("model-providers"),
  loaderDeps: (_context: ApplicationContext, location: RouteLocation) => location.search,
  loader: loadModelProvidersRouteData,
  component: () =>
    import("./model-providers-page.ts").then(() => ({
      header: true,
      render: (data: ModelProvidersRouteData | undefined, loaderPending = false) =>
        html`<openclaw-model-providers-page
          .routeData=${data}
          .loaderPending=${loaderPending}
        ></openclaw-model-providers-page>`,
    })),
});
