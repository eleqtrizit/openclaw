import { redactAssignmentValues, redactFormBody, redactStructuredAuthHeaders } from "./src/logging/redact.js";
import { resolveRedactOptions, redactText } from "./src/logging/redact.js";

const input = "body: client_secre%74=opaque-value-123&safe=1";
const s1 = redactStructuredAuthHeaders(input, "***");
console.log("S1 structured:", JSON.stringify(s1));
const s2 = redactAssignmentValues(s1, "url");
console.log("S2 assignment:", JSON.stringify(s2));
const s3 = redactFormBody(s2);
console.log("S3 formbody:", JSON.stringify(s3));
const resolved = resolveRedactOptions({ mode: "tools" });
const s4 = redactText(s3, resolved.patterns);
console.log("S4 patterns:", JSON.stringify(s4));
