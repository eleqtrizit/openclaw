/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForFast } from "../../test-helpers/wait-for.ts";
import { EMPTY_MODEL_PROVIDERS_DATA } from "./load.ts";
import {
  createHarness,
  type ModelProvidersPageTestElement,
} from "./model-providers-page.test-support.ts";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("targeted model provider access", () => {
  it("opens the custom provider API-key action for the selected agent", async () => {
    const { context, snapshot } = createHarness("main");
    const page = document.createElement(
      "openclaw-model-providers-page",
    ) as ModelProvidersPageTestElement;
    page.context = context;
    page.routeData = {
      gateway: context.gateway,
      gatewaySnapshot: snapshot,
      data: {
        ...EMPTY_MODEL_PROVIDERS_DATA,
        config: { models: { providers: { inference: {} } } },
        authStatus: { ts: 1, providers: [], providerCapabilities: [] },
        models: [
          {
            id: "reasoner",
            name: "Reasoner",
            provider: "inference",
            available: false,
            unavailableReason: "missing-agent-auth",
            credentialType: "api-key",
          },
        ],
        updatedAt: Date.now(),
      },
      client: snapshot.client,
      agentId: "main",
      focusProvider: "inference",
      focusCredential: "api-key",
    };
    document.body.append(page);

    await waitForFast(() =>
      expect(
        page.querySelector<HTMLInputElement>(
          '[data-provider-id="inference"] .model-providers__inline-form input[type="password"]',
        ),
      ).not.toBeNull(),
    );
    expect(page.keyEditorProvider).toBe("inference");
    expect(document.activeElement).toBe(
      page.querySelector('[data-provider-id="inference"] input[type="password"]'),
    );
    expect(page.textContent).toContain("Credentials for Main");
  });

  it("focuses honest setup guidance when token editing is unavailable", async () => {
    const { context, snapshot } = createHarness("main");
    const page = document.createElement(
      "openclaw-model-providers-page",
    ) as ModelProvidersPageTestElement;
    page.context = context;
    page.routeData = {
      gateway: context.gateway,
      gatewaySnapshot: snapshot,
      data: {
        ...EMPTY_MODEL_PROVIDERS_DATA,
        config: { models: { providers: { inference: { auth: "token" } } } },
        authStatus: { ts: 1, providers: [], providerCapabilities: [] },
        models: [
          {
            id: "reasoner",
            name: "Reasoner",
            provider: "inference",
            available: false,
            unavailableReason: "missing-agent-auth",
            credentialType: "token",
          },
        ],
        updatedAt: Date.now(),
      },
      client: snapshot.client,
      agentId: "main",
      focusProvider: "inference",
      focusCredential: "token",
    };
    document.body.append(page);

    await waitForFast(() =>
      expect(page.querySelector('[data-provider-id="inference"]')).not.toBeNull(),
    );
    const setKey = [...page.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Set API key"),
    );
    expect(page.keyEditorProvider).toBeNull();
    expect(page.textContent).toContain("Credentials for Main");
    expect(setKey?.disabled).toBe(true);
    expect(setKey?.title).toContain('auth mode is "token"');
  });
});
