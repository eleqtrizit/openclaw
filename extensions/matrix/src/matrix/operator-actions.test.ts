import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreConfig } from "../types.js";
import { runMatrixOperatorAction } from "./operator-actions.js";

const verificationMocks = vi.hoisted(() => ({
  acceptMatrixVerification: vi.fn(),
  bootstrapMatrixVerification: vi.fn(),
  cancelMatrixVerification: vi.fn(),
  confirmMatrixVerificationSas: vi.fn(),
  getMatrixRoomKeyBackupStatus: vi.fn(),
  getMatrixVerificationSas: vi.fn(),
  getMatrixVerificationStatus: vi.fn(),
  listMatrixVerifications: vi.fn(),
  mismatchMatrixVerificationSas: vi.fn(),
  requestMatrixVerification: vi.fn(),
  resetMatrixRoomKeyBackup: vi.fn(),
  restoreMatrixRoomKeyBackup: vi.fn(),
  startMatrixVerification: vi.fn(),
  verifyMatrixRecoveryKey: vi.fn(),
}));

vi.mock("./actions/verification.js", () => verificationMocks);

const cfg: CoreConfig = {
  channels: {
    matrix: {
      accounts: {
        ops: {
          homeserver: "https://matrix.example.org",
          actions: { verification: false },
        },
      },
    },
  },
};

describe("Matrix operator actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not inherit the agent verification-action gate", async () => {
    const status = { serverDeviceKnown: true };
    verificationMocks.getMatrixVerificationStatus.mockResolvedValue(status);

    await expect(
      runMatrixOperatorAction({
        cfg,
        input: { operation: "verification-status", accountId: "ops" },
      }),
    ).resolves.toEqual({ status });
    expect(verificationMocks.getMatrixVerificationStatus).toHaveBeenCalledWith({
      accountId: "ops",
      cfg,
      includeRecoveryKey: false,
    });
  });

  it("rejects backup reset unless the CLI confirmation crosses the boundary", async () => {
    await expect(
      runMatrixOperatorAction({
        cfg,
        input: { operation: "verification-backup-reset", accountId: "ops" },
      }),
    ).rejects.toThrow("requires explicit confirmation");
    expect(verificationMocks.resetMatrixRoomKeyBackup).not.toHaveBeenCalled();
  });

  it("allows a confirmed admin backup reset", async () => {
    const result = { success: true };
    verificationMocks.resetMatrixRoomKeyBackup.mockResolvedValue(result);

    await expect(
      runMatrixOperatorAction({
        cfg,
        input: {
          operation: "verification-backup-reset",
          accountId: "ops",
          confirmBackupReset: true,
          rotateRecoveryKey: true,
        },
      }),
    ).resolves.toEqual({ result });
    expect(verificationMocks.resetMatrixRoomKeyBackup).toHaveBeenCalledWith({
      accountId: "ops",
      cfg,
      rotateRecoveryKey: true,
    });
  });
});
