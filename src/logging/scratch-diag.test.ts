import { describe, expect, it } from "vitest";
import { redactSensitiveText, getDefaultRedactPatterns } from "./redact.js";
import { TOOL_PAYLOAD_AMBIGUOUS_ASSIGNMENT_PATTERNS } from "./redact-patterns.js";
import { redactSourceInputTextWithConfig } from "./redact-source.js";
import { withFullContextToolPayloadRedaction } from "./redact.test-support.js";
import {
  redactRegisteredSecretValues,
  registerSecretValueForRedaction,
} from "./secret-redaction-registry.js";
import { resetSecretRedactionRegistryForTest } from "./secret-redaction-registry.test-support.js";

const defaults = getDefaultRedactPatterns();

describe("bisect sequence", () => {
  it("full three-call sequence", () => {
    const r1 = redactSensitiveText("body: client%5Fse\u200Bcret=opaque-value-123&safe=1", { mode: "tools" });
    console.log("R1:", JSON.stringify(r1));
    const r2 = redactSensitiveText("GET https://example.test/cb?client_se+cret=***&safe=1", { mode: "tools" });
    console.log("R2:", JSON.stringify(r2));
    const r3 = redactSensitiveText("body: client_secre%74=***&safe=1", { mode: "tools" });
    console.log("R3:", JSON.stringify(r3));
    expect(r3).toBe("body: client_secre%74=***&safe=1");
  });
});
