import { describe, expect, it } from "vitest";
import type { GatewayAgentRow } from "../../api/types.ts";
import { waitForFast } from "../../test-helpers/wait-for.ts";
import { contextWith, renderControl } from "./model-control.test-support.ts";
import { NewSessionModelControl } from "./model-control.ts";

describe("new-session missing agent provider access", () => {
  it("routes the credential gap to the selected agent's provider setup", async () => {
    const { context, navigate } = contextWith([
      {
        id: "reasoner",
        name: "Reasoner",
        provider: "inference",
        available: false,
        unavailableReason: "missing-agent-auth",
        credentialType: "api-key",
      },
    ]);
    const agent = {
      id: "main",
      name: "Pinchita",
      model: { primary: "inference/reasoner" },
    } satisfies GatewayAgentRow;
    const control = new NewSessionModelControl(() => undefined);
    control.load(context, "main", true, { agent });

    await waitForFast(() =>
      expect(
        renderControl(control, context, "main", agent).querySelector("[data-chat-model-option]"),
      ).not.toBeNull(),
    );
    const container = renderControl(control, context, "main", agent);
    const option = container.querySelector<HTMLButtonElement>("[data-chat-model-option]");
    expect(option?.textContent).toContain("Access not configured for Pinchita");
    option?.click();
    expect(navigate).toHaveBeenCalledWith("model-providers", {
      search: "?provider=inference&credential=api-key",
    });
  });
});
