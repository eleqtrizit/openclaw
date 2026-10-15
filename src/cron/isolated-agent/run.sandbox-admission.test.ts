import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setRuntimeConfigSnapshot } from "../../config/config.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { RunCronAgentTurnParams } from "./run-prepare-runtime.js";
import {
  clearFastTestEnv,
  isCliProviderMock,
  loadRunCronIsolatedAgentTurn,
  makeCronSession,
  makeCronSessionEntry,
  mockRunCronFallbackPassthrough,
  resetRunCronIsolatedAgentTurnHarness,
  resolveAllowedModelRefMock,
  resolveConfiguredModelRefMock,
  resolveCronSessionMock,
  resolveThinkingDefaultMock,
  restoreFastTestEnv,
  runCliAgentMock,
  runEmbeddedAgentMock,
} from "./run.test-harness.js";

const runCronIsolatedAgentTurn = await loadRunCronIsolatedAgentTurn();

const sessionId = "cron-sandbox-admission-session";

function makeSandboxAdmissionParams(
  cfg: OpenClawConfig,
  payloadModel?: string,
): RunCronAgentTurnParams {
  setRuntimeConfigSnapshot(cfg);
  return {
    deliveryAttemptFence: null,
    cfg,
    deps: {},
    job: {
      id: "sandbox-admission-job",
      name: "Sandbox admission",
      enabled: true,
      createdAtMs: 0,
      updatedAtMs: 0,
      schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
      sessionTarget: "session:existing-cron-session",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message: "summarize",
        ...(payloadModel ? { model: payloadModel } : {}),
      },
      state: {},
    },
    message: "summarize",
    sessionKey: "existing-cron-session",
  };
}

describe("cron isolated-agent sandbox placement admission", () => {
  let previousFastTestEnv: string | undefined;

  beforeEach(() => {
    previousFastTestEnv = clearFastTestEnv();
    resetRunCronIsolatedAgentTurnHarness();
    isCliProviderMock.mockImplementation((provider: string) => provider === "test-cli");
    resolveConfiguredModelRefMock.mockReturnValue({ provider: "openai", model: "gpt-test" });
    resolveAllowedModelRefMock.mockImplementation(
      ({ raw }: { raw?: string }) =>
        ({
          ref: raw?.includes("test-cli")
            ? { provider: "test-cli", model: "claude-x" }
            : { provider: "openai", model: "gpt-test" },
        }) as never,
    );
    resolveThinkingDefaultMock.mockReturnValue("off");
    resolveCronSessionMock.mockReturnValue(
      makeCronSession({ sessionEntry: makeCronSessionEntry({ sessionId }), isNewSession: true }),
    );
    runCliAgentMock.mockResolvedValue({
      payloads: [{ text: "summary done" }],
      meta: {
        durationMs: 1,
        executionTrace: { runner: "cli" },
        agentMeta: { provider: "test-cli", model: "claude-x", usage: { input: 1, output: 1 } },
      },
    });
    mockRunCronFallbackPassthrough();
  });

  afterEach(() => {
    restoreFastTestEnv(previousFastTestEnv);
  });

  it("fails closed when a sandboxed session inherits a CLI-backed subagent default", async () => {
    const cfg: OpenClawConfig = {
      agents: {
        defaults: { sandbox: { mode: "all" }, subagents: { model: "test-cli/claude-x" } },
      },
    };
    const result = await runCronIsolatedAgentTurn(makeSandboxAdmissionParams(cfg));

    expect(result.status).toBe("error");
    expect(result.error).toContain("cannot honor the sandbox");
    expect(runCliAgentMock).not.toHaveBeenCalled();
    expect(runEmbeddedAgentMock).not.toHaveBeenCalled();
  });

  it("fails closed for an explicit CLI payload model in a sandboxed session", async () => {
    const cfg: OpenClawConfig = {
      agents: { defaults: { sandbox: { mode: "all" } } },
    };
    const result = await runCronIsolatedAgentTurn(
      makeSandboxAdmissionParams(cfg, "test-cli/claude-x"),
    );

    expect(result.status).toBe("error");
    expect(result.error).toContain("cannot honor the sandbox");
    expect(runCliAgentMock).not.toHaveBeenCalled();
  });

  it("fails closed when the session entry carries required sandbox isolation", async () => {
    const cfg: OpenClawConfig = {
      agents: { defaults: { subagents: { model: "test-cli/claude-x" } } },
    };
    resolveCronSessionMock.mockReturnValue(
      makeCronSession({
        sessionEntry: makeCronSessionEntry({ sessionId, sandbox: "required" }),
        isNewSession: true,
      }),
    );
    const result = await runCronIsolatedAgentTurn(makeSandboxAdmissionParams(cfg));

    expect(result.status).toBe("error");
    expect(result.error).toContain("cannot honor the sandbox");
    expect(runCliAgentMock).not.toHaveBeenCalled();
  });

  it("admits a sandboxed session that resolves an API-backed model", async () => {
    const cfg: OpenClawConfig = {
      agents: {
        defaults: { sandbox: { mode: "all" }, subagents: { model: "openai/gpt-test" } },
      },
    };
    const result = await runCronIsolatedAgentTurn(makeSandboxAdmissionParams(cfg));

    expect(result.status).toBe("ok");
    expect(runCliAgentMock).not.toHaveBeenCalled();
    expect(runEmbeddedAgentMock).toHaveBeenCalledOnce();
  });

  it("keeps CLI execution for unsandboxed sessions", async () => {
    const cfg: OpenClawConfig = {
      agents: { defaults: { subagents: { model: "test-cli/claude-x" } } },
    };
    const result = await runCronIsolatedAgentTurn(makeSandboxAdmissionParams(cfg));

    expect(result.status).toBe("ok");
    expect(runCliAgentMock).toHaveBeenCalledOnce();
    expect(runEmbeddedAgentMock).not.toHaveBeenCalled();
  });
});
