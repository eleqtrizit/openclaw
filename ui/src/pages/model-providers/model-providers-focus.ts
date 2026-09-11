import { normalizeProviderId } from "@openclaw/model-catalog-core/provider-id";

type ModelProviderFocusHost = HTMLElement & { updateComplete: Promise<unknown> };
type ModelProviderFocusRoute = {
  focusProvider?: string | null;
  focusCredential?: string | null;
};

export function applyProviderFocus(
  host: ModelProviderFocusHost,
  route: ModelProviderFocusRoute,
  openKeyEditor: (provider: string) => void,
) {
  const provider = normalizeProviderId(route.focusProvider ?? "");
  if (!provider) {
    return;
  }
  if (route.focusCredential === "api-key") {
    openKeyEditor(provider);
  }
  void host.updateComplete.then(() => {
    const row = [...host.querySelectorAll<HTMLElement>("[data-provider-id]")].find(
      (candidate) => candidate.dataset.providerId === provider,
    );
    row?.scrollIntoView?.({ block: "center" });
    if (route.focusCredential === "api-key") {
      row
        ?.querySelector<HTMLInputElement>('.model-providers__inline-form input[type="password"]')
        ?.focus();
    }
  });
}
