import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMatrixCliOwnerAction } from "./cli-shared.js";

const gatewayMocks = vi.hoisted(() => ({
  callGatewayFromCli: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/gateway-runtime", () => ({
  callGatewayFromCli: gatewayMocks.callGatewayFromCli,
  isGatewayClientRequestError: (error: unknown) =>
    error instanceof Error && error.name === "GatewayClientRequestError",
  isGatewayTransportError: (error: unknown) =>
    error instanceof Error && error.name === "GatewayTransportError",
}));

function gatewayTransportError(code?: number): Error {
  return Object.assign(new Error("gateway transport failed"), {
    name: "GatewayTransportError",
    kind: "closed",
    ...(code === undefined ? {} : { code }),
  });
}

function gatewayRequestError(message: string): Error {
  return Object.assign(new Error(message), {
    name: "GatewayClientRequestError",
    gatewayCode: "INVALID_REQUEST",
  });
}

describe("Matrix CLI owner actions", () => {
  beforeEach(() => {
    gatewayMocks.callGatewayFromCli.mockReset();
  });

  it("uses the authenticated Gateway owner before opening crypto locally", async () => {
    const ownerStatus = { serverDeviceKnown: true, signedByOwner: true };
    const runLocal = vi.fn(async () => ({ serverDeviceKnown: false }));
    gatewayMocks.callGatewayFromCli.mockResolvedValue({ ok: true, status: ownerStatus });

    await expect(
      runMatrixCliOwnerAction({
        accountId: "ops",
        operation: "verification-status",
        actionParams: { includeRecoveryKey: false },
        resultField: "status",
        runLocal,
      }),
    ).resolves.toBe(ownerStatus);

    expect(runLocal).not.toHaveBeenCalled();
    expect(gatewayMocks.callGatewayFromCli).toHaveBeenCalledWith(
      "matrix.operatorAction",
      {},
      {
        operation: "verification-status",
        accountId: "ops",
        includeRecoveryKey: false,
      },
      {
        clientName: "cli",
        mode: "cli",
        progress: false,
        scopes: ["operator.admin", "operator.write", "operator.read"],
      },
    );
  });

  it("runs locally only when no Gateway is listening", async () => {
    const localStatus = { serverDeviceKnown: true };
    gatewayMocks.callGatewayFromCli.mockRejectedValue(gatewayTransportError());

    await expect(
      runMatrixCliOwnerAction({
        accountId: "ops",
        operation: "verification-status",
        resultField: "status",
        runLocal: async () => localStatus,
      }),
    ).resolves.toBe(localStatus);
  });

  it("fails closed when a live older Gateway lacks the operator method", async () => {
    const runLocal = vi.fn(async () => ({ serverDeviceKnown: true }));
    gatewayMocks.callGatewayFromCli.mockRejectedValue(
      gatewayRequestError("unknown method: matrix.operatorAction"),
    );

    await expect(
      runMatrixCliOwnerAction({
        accountId: "ops",
        operation: "verification-status",
        resultField: "status",
        runLocal,
      }),
    ).rejects.toThrow("Restart it with the current OpenClaw version");
    expect(runLocal).not.toHaveBeenCalled();
  });

  it("does not fall back during a live Gateway restart or authorization failure", async () => {
    const runLocal = vi.fn(async () => ({ serverDeviceKnown: true }));
    const error = gatewayTransportError(1006);
    gatewayMocks.callGatewayFromCli.mockRejectedValue(error);

    await expect(
      runMatrixCliOwnerAction({
        accountId: "ops",
        operation: "verification-status",
        resultField: "status",
        runLocal,
      }),
    ).rejects.toBe(error);
    expect(runLocal).not.toHaveBeenCalled();
  });
});
