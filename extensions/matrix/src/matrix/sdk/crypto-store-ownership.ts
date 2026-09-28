import {
  acquireFileLock,
  FILE_LOCK_STALE_ERROR_CODE,
  FILE_LOCK_TIMEOUT_ERROR_CODE,
  type FileLockHandle,
  type FileLockOptions,
} from "openclaw/plugin-sdk/file-lock";

const MATRIX_CRYPTO_STORE_OWNER_ACTIVE_ERROR_CODE = "matrix_crypto_store_owner_active";

class MatrixCryptoStoreOwnerActiveError extends Error {
  readonly code = MATRIX_CRYPTO_STORE_OWNER_ACTIVE_ERROR_CODE;
  readonly retryViaGateway = true;

  constructor(cause: unknown) {
    super(
      "Matrix crypto state is already owned by another OpenClaw process; retry through the running Gateway",
      { cause },
    );
    this.name = "MatrixCryptoStoreOwnerActiveError";
  }
}

export type MatrixCryptoStoreOwnership = Pick<FileLockHandle, "release">;

const MATRIX_CRYPTO_STORE_OWNER_LOCK_OPTIONS: FileLockOptions = {
  retries: {
    retries: 0,
    factor: 1,
    minTimeout: 0,
    maxTimeout: 0,
  },
  // Process identity, not elapsed time, decides whether lifetime custody is stale.
  stale: 0,
  staleRecovery: "remove-if-definitely-stale",
};

function isOwnershipContention(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if (!("code" in error)) {
    return false;
  }
  return error.code === FILE_LOCK_TIMEOUT_ERROR_CODE || error.code === FILE_LOCK_STALE_ERROR_CODE;
}

export async function acquireMatrixCryptoStoreOwnership(
  snapshotPath: string,
): Promise<MatrixCryptoStoreOwnership> {
  try {
    return await acquireFileLock(`${snapshotPath}.owner`, MATRIX_CRYPTO_STORE_OWNER_LOCK_OPTIONS);
  } catch (error) {
    if (isOwnershipContention(error)) {
      throw new MatrixCryptoStoreOwnerActiveError(error);
    }
    throw error;
  }
}
