import { normalizeOptionalString } from "openclaw/plugin-sdk/string-coerce-runtime";
import type { CoreConfig } from "../types.js";
import {
  acceptMatrixVerification,
  bootstrapMatrixVerification,
  cancelMatrixVerification,
  confirmMatrixVerificationSas,
  getMatrixRoomKeyBackupStatus,
  getMatrixVerificationSas,
  getMatrixVerificationStatus,
  listMatrixVerifications,
  mismatchMatrixVerificationSas,
  requestMatrixVerification,
  resetMatrixRoomKeyBackup,
  restoreMatrixRoomKeyBackup,
  startMatrixVerification,
  verifyMatrixRecoveryKey,
} from "./actions/verification.js";

export type MatrixOperatorActionParams = Record<string, unknown> & {
  accountId?: unknown;
  operation?: unknown;
};

type MatrixOperatorActionResult = Record<string, unknown>;

function readOptionalString(params: MatrixOperatorActionParams, key: string): string | undefined {
  return normalizeOptionalString(params[key]);
}

function readRequiredString(params: MatrixOperatorActionParams, key: string): string {
  const value = readOptionalString(params, key);
  if (!value) {
    throw new Error(`${key} required`);
  }
  return value;
}

function readOptionalRawString(
  params: MatrixOperatorActionParams,
  key: string,
): string | undefined {
  return typeof params[key] === "string" ? params[key] : undefined;
}

function readRequiredRawString(params: MatrixOperatorActionParams, key: string): string {
  const value = readOptionalRawString(params, key);
  if (!value) {
    throw new Error(`${key} required`);
  }
  return value;
}

export async function runMatrixOperatorAction(params: {
  cfg: CoreConfig;
  input: MatrixOperatorActionParams;
}): Promise<MatrixOperatorActionResult> {
  const { input, cfg } = params;
  const operation = readRequiredString(input, "operation").toLowerCase();
  const accountId = readOptionalString(input, "accountId");
  const clientOpts = { accountId, cfg };
  const requestId = () => readRequiredString(input, "requestId");
  const verificationOpts = {
    ...clientOpts,
    verificationDmUserId: readOptionalString(input, "userId"),
    verificationDmRoomId: readOptionalString(input, "roomId"),
  };

  switch (operation) {
    case "verification-status":
      return {
        status: await getMatrixVerificationStatus({
          ...clientOpts,
          includeRecoveryKey: input.includeRecoveryKey === true,
        }),
      };
    case "verification-bootstrap": {
      const result = await bootstrapMatrixVerification({
        ...clientOpts,
        recoveryKey: readOptionalRawString(input, "recoveryKey"),
        forceResetCrossSigning: input.forceResetCrossSigning === true,
      });
      return { result };
    }
    case "verification-recovery-key": {
      const result = await verifyMatrixRecoveryKey(
        readRequiredRawString(input, "recoveryKey"),
        clientOpts,
      );
      return { result };
    }
    case "verification-backup-status":
      return { status: await getMatrixRoomKeyBackupStatus(clientOpts) };
    case "verification-backup-reset": {
      if (input.confirmBackupReset !== true) {
        throw new Error("Matrix room-key backup reset requires explicit confirmation");
      }
      const result = await resetMatrixRoomKeyBackup({
        ...clientOpts,
        rotateRecoveryKey: input.rotateRecoveryKey === true,
      });
      return { result };
    }
    case "verification-backup-restore": {
      const result = await restoreMatrixRoomKeyBackup({
        ...clientOpts,
        recoveryKey: readOptionalRawString(input, "recoveryKey"),
      });
      return { result };
    }
    case "verification-list":
      return { verifications: await listMatrixVerifications(clientOpts) };
    case "verification-request":
      return {
        verification: await requestMatrixVerification({
          ...clientOpts,
          ownUser: input.ownUser === true ? true : undefined,
          userId: readOptionalString(input, "userId"),
          deviceId: readOptionalString(input, "deviceId"),
          roomId: readOptionalString(input, "roomId"),
        }),
      };
    case "verification-accept":
      return {
        verification: await acceptMatrixVerification(requestId(), verificationOpts),
      };
    case "verification-start":
      return {
        verification: await startMatrixVerification(requestId(), {
          ...verificationOpts,
          method: "sas",
        }),
      };
    case "verification-sas":
      return { sas: await getMatrixVerificationSas(requestId(), verificationOpts) };
    case "verification-confirm":
      return {
        verification: await confirmMatrixVerificationSas(requestId(), verificationOpts),
      };
    case "verification-mismatch":
      return {
        verification: await mismatchMatrixVerificationSas(requestId(), verificationOpts),
      };
    case "verification-cancel":
      return {
        verification: await cancelMatrixVerification(requestId(), {
          ...verificationOpts,
          reason: readOptionalString(input, "reason"),
          code: readOptionalString(input, "code"),
        }),
      };
    default:
      throw new Error(`Unsupported Matrix operator operation: ${operation}`);
  }
}
