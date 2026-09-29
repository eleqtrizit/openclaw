import { formatZonedTimestamp } from "openclaw/plugin-sdk/time-runtime";

export function healthyMatrixBackup(overrides: Record<string, unknown> = {}) {
  return {
    serverVersion: "1",
    activeVersion: "1",
    trusted: true,
    matchesDecryptionKey: true,
    decryptionKeyCached: true,
    ...overrides,
  };
}

export function diagnosticMatrixBackup(overrides: Record<string, unknown> = {}) {
  return {
    ...healthyMatrixBackup(),
    keyLoadAttempted: false,
    keyLoadError: null,
    ...overrides,
  };
}

export function matrixVerificationState(overrides: Record<string, unknown> = {}) {
  const { backup: backupOverrides, ...statusOverrides } = overrides;
  return {
    encryptionEnabled: true,
    verified: true,
    localVerified: true,
    crossSigningVerified: true,
    signedByOwner: true,
    userId: "@bot:example.org",
    deviceId: "DEVICE123",
    backupVersion: "1",
    backup: healthyMatrixBackup(backupOverrides as Record<string, unknown> | undefined),
    recoveryKeyStored: true,
    recoveryKeyCreatedAt: null,
    ...statusOverrides,
  };
}

export function matrixVerificationStatus(overrides: Record<string, unknown> = {}) {
  return { ...matrixVerificationState(overrides), pendingVerifications: 0 };
}

export function successfulMatrixBootstrap(
  recoveryKeyCreatedAt: string | null = null,
  backupVersion: string | null = null,
) {
  return {
    success: true,
    verification: { recoveryKeyCreatedAt, backupVersion },
    crossSigning: {},
    pendingVerifications: 0,
    cryptoBootstrap: {},
  };
}

export function formatExpectedLocalTimestamp(value: string): string {
  return formatZonedTimestamp(new Date(value), { displaySeconds: true }) ?? value;
}

export function mockMatrixVerificationSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: "self-1",
    transactionId: "txn-1",
    otherUserId: "@bot:example.org",
    otherDeviceId: "PHONE123",
    isSelfVerification: true,
    initiatedByMe: true,
    phaseName: "started",
    pending: true,
    methods: ["m.sas.v1"],
    chosenMethod: "m.sas.v1",
    hasSas: true,
    sas: { decimal: [1234, 5678, 9012] },
    completed: false,
    ...overrides,
  };
}
