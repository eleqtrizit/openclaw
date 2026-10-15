import { AgentHarnessPreflightError } from "../../agents/harness/errors.js";
import {
  resolvePreparedSandboxRuntimeStatus,
  type SandboxRuntimeStatusParams,
} from "../../agents/sandbox/runtime-status.js";
import type { CronRuntimeAuthority } from "../runtime-authority.js";

export function assertCronRuntimeAuthorityCandidate(params: {
  authority?: CronRuntimeAuthority;
  candidateRuntime: string;
  cliExecution: boolean;
}): void {
  const authority = params.authority;
  if (!authority) {
    return;
  }
  if (params.candidateRuntime !== authority.runtimeId || params.cliExecution) {
    throw new AgentHarnessPreflightError(
      `This automation carries ${authority.namespace} authority captured for the ${authority.runtimeId} runtime, but the selected execution runtime is ${params.candidateRuntime}. Restore that runtime and auth profile, or explicitly replace the automation's toolsAllow cap from an authenticated creator turn.`,
    );
  }
}

/** Sandbox placement facts for one isolated run; resolved once from the prepared session entry. */
export type CronSandboxPlacement = {
  sessionSandboxRequired?: boolean | undefined;
  sessionSandboxed: boolean;
};

/** Resolves the run's sandbox placement facts from the prepared session entry. */
export function resolveCronSandboxPlacement(params: SandboxRuntimeStatusParams & {
  preparedSessionEntry: SandboxRuntimeStatusParams["preparedSessionEntry"];
}): CronSandboxPlacement {
  const status = resolvePreparedSandboxRuntimeStatus(params);
  return {
    sessionSandboxRequired: status.sandboxRequired,
    sessionSandboxed: status.sandboxed,
  };
}

/**
 * Sandboxed sessions never dispatch to host-executed CLI backends.
 *
 * A CLI backend spawns a local AI CLI on the gateway host; its native tools run
 * with the gateway OS user outside any configured Docker sandbox. When this
 * session is classified as sandboxed (the configured sandbox mode covers this
 * session key) or carries required sandbox isolation (a creator-mandated
 * containment), admitting a CLI candidate would silently move tool execution
 * from the container to the host while `openclaw sandbox explain` still
 * reports the session as sandboxed. Fail closed instead of dispatching: pin
 * the model per agent (`agents.entries.<id>.subagents.model`) or per defaults
 * (`agents.defaults.subagents.model`) to an API-backed model, or change the
 * agent's sandbox policy explicitly.
 */
export function assertCronCandidateSandboxPlacement(params: {
  sessionSandboxRequired?: boolean | undefined;
  sessionSandboxed: boolean;
  cliExecution: boolean;
  executionProvider: string;
}): void {
  if (!params.cliExecution) {
    return;
  }
  // Unclasstrained sessions keep CLI execution: the sandbox classification
  // already folds the configured mode ("all", or "non-main" away from the
  // agent's main session) into the sessionSandboxed fact for this key.
  if (!params.sessionSandboxed && !params.sessionSandboxRequired) {
    return;
  }
  throw new AgentHarnessPreflightError(
    `This automation belongs to a sandboxed session, but resolved execution provider ${params.executionProvider} runs on the host and cannot honor the sandbox. Pin the automation to a sandbox-compatible model (e.g. set agents.entries.<id>.subagents.model or the agent's own model to an API-backed provider), or change the agent's sandbox policy explicitly.`,
  );
}
