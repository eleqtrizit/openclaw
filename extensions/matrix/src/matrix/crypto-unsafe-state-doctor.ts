// Matrix storage-owned inspection and explicit recovery of failed crypto publication.
import fs from "node:fs/promises";
import path from "node:path";
import { getMatrixRuntime } from "../runtime.js";
import {
  MATRIX_IDB_SNAPSHOT_FILENAME,
  openMatrixIdbSnapshotStoreOptions,
  readMatrixIdbSnapshotJsonFromStore,
  type MatrixIdbSnapshotRecord,
} from "./crypto-state-store.js";
import {
  clearMatrixCryptoStoreUnsafeState,
  withMatrixCryptoStoreRecoveryLock,
} from "./sdk/crypto-store-ownership.js";
import { walkMatrixStateFiles } from "./state-layout-walk.js";

const MARKER_NAME = `${MATRIX_IDB_SNAPSHOT_FILENAME}.owner.poisoned`;

export async function listMatrixCryptoUnsafeState(stateDir: string): Promise<string[]> {
  const { entries, failedDirs } = await walkMatrixStateFiles(
    stateDir,
    (name, depth) => depth === 4 && name === MARKER_NAME,
  );
  if (failedDirs.length > 0) {
    throw failedDirs[0]!.error;
  }
  return entries.map((entry) => path.dirname(entry.path)).toSorted();
}

/** A valid snapshot is a rollback point, not proof that the failed owner's last keys were saved. */
export async function recoverMatrixCryptoUnsafeState(params: {
  storageRootDir: string;
  acceptSnapshotRollback: boolean;
}): Promise<void> {
  if (!params.acceptSnapshotRollback) {
    throw new Error("Matrix crypto recovery requires explicit --accept-snapshot-rollback.");
  }
  const snapshotPath = path.join(params.storageRootDir, MATRIX_IDB_SNAPSHOT_FILENAME);
  await withMatrixCryptoStoreRecoveryLock(snapshotPath, async (markerPath) => {
    const marker = await fs.lstat(markerPath);
    if (!marker.isFile() || marker.isSymbolicLink()) {
      throw new Error("Matrix crypto refusal marker is not a regular file; refusing recovery.");
    }
    try {
      await fs.access(path.join(params.storageRootDir, "state", "openclaw.sqlite"));
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new Error("Matrix crypto SQLite snapshot is absent; refusal remains in place.", {
          cause: error,
        });
      }
      throw error;
    }
    const store = getMatrixRuntime().state.openKeyedStore<MatrixIdbSnapshotRecord>(
      openMatrixIdbSnapshotStoreOptions(params.storageRootDir),
    );
    const snapshot = await readMatrixIdbSnapshotJsonFromStore({ store });
    const { isValidMatrixIdbSnapshotJson } = await import("./sdk/idb-persistence.js");
    if (!snapshot || !isValidMatrixIdbSnapshotJson(snapshot)) {
      throw new Error(
        "Matrix crypto SQLite snapshot is absent or invalid; refusal remains in place.",
      );
    }
    // Keep the marker under the owner lock until validation and explicit operator acceptance.
    // No crypto keys are read into a Matrix client during this operation.
    await clearMatrixCryptoStoreUnsafeState(snapshotPath);
  });
}
