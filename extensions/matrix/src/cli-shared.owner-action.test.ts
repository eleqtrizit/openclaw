import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMatrixCliOwnerAction } from "./cli-shared.js";

const gatewayMocks = vi.hoisted(() => ({
  callGatewayFromCli: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/gateway-runtime", () => ({
  callGatewayFromCli: gatewayMocks.callGatewayFromCli,
}));

function ownerActiveError(): Error & { code: string } {
  return Object.assign(new Error("owner active"), {
    code: "matrix_crypto_store_owner_active",
  });
}

describe("Matrix CLI owner actions", () => {
  beforeEach(() => {
    gatewayMocks.callGatewayFromCli.mockReset();
  });

  it("keeps standalone commands local when no other process owns crypto", async () => {
    const localStatus = { serverDeviceKnown: true };

    await expect(
      runMatrixCliOwnerAction({
        accountId: "ops",
        operation: "verification-status",
        resultField: "status",
        runLocal: async () => localStatus,
      }),
    ).resolves.toBe(localStatus);
    expect(gatewayMocks.callGatewayFromCli).not.toHaveBeenCalled();
  });

  it("routes a contended command through the authenticated Gateway owner", async () => {
    const ownerStatus = { serverDeviceKnown: true, signedByOwner: true };
    gatewayMocks.callGatewayFromCli.mockResolvedValue({ ok: true, status: ownerStatus });

    await expect(
      runMatrixCliOwnerAction({
        accountId: "ops",
        operation: "verification-status",
        actionParams: { includeRecoveryKey: false },
        resultField: "status",
        runLocal: async () => {
          throw ownerActiveError();
        },
      }),
    ).resolves.toBe(ownerStatus);

    expect(gatewayMocks.callGatewayFromCli).toHaveBeenCalledWith(
      "message.action",
      {},
      {
        channel: "matrix",
        action: "permissions",
        accountId: "ops",
        senderIsOwner: true,
        params: {
          operation: "verification-status",
          accountId: "ops",
          includeRecoveryKey: false,
        },
      },
      {
        clientName: "cli",
        mode: "cli",
        progress: false,
        scopes: ["operator.admin", "operator.write", "operator.read"],
      },
    );
  });

  it("does not hide unrelated local command failures", async () => {
    const failure = new Error("homeserver unavailable");

    await expect(
      runMatrixCliOwnerAction({
        accountId: "ops",
        operation: "verification-backup-status",
        resultField: "status",
        runLocal: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(gatewayMocks.callGatewayFromCli).not.toHaveBeenCalled();
  });
});
