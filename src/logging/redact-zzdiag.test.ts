import { describe, it } from "vitest";
import { redactSensitiveText } from "./redact.js";

describe("order dependence", () => {
  it("consecutive identical calls", () => {
    const r1 = redactSensitiveText("body: client%5Fse\u200Bcret=opaque-value-123&safe=1", { mode: "tools" });
    console.log("R1:", JSON.stringify(r1));
    const r2 = redactSensitiveText("GET https://example.test/cb?client_se+cret=***&safe=1", { mode: "tools" });
    console.log("R2:", JSON.stringify(r2));
    const r3a = redactSensitiveText("body: client_secre%74=***&safe=1", { mode: "tools" });
    console.log("R3a:", JSON.stringify(r3a));
    const r3b = redactSensitiveText("body: client_secre%74=***&safe=1", { mode: "tools" });
    console.log("R3b:", JSON.stringify(r3b));
    const r3c = redactSensitiveText("body: client_secre%74=***&safe=1", { mode: "tools" });
    console.log("R3c:", JSON.stringify(r3c));
  });
  it("cold call only", () => {
    const r = redactSensitiveText("body: client_secre%74=***&safe=1", { mode: "tools" });
    console.log("COLD:", JSON.stringify(r));
  });
});
