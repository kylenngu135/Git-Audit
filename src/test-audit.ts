import { findRepoRoot, savePromptEvent, loadPromptEvent } from "./shared/eventStore.js";
import { generateId, getCurrentTimestamp } from "./shared/utils.js";
import { generateAuditCard } from "./audit/cardGenerator.js";
import { saveAuditCard, saveOrUpdateFunctionRecord, loadFunctionRecord } from "./audit/cardStore.js";
import type { PromptEvent, AuditContext } from "./shared/types.js";
import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = await findRepoRoot(process.cwd());

// Create a linked prompt event
const event: PromptEvent = {
  id: generateId(),
  timestamp: getCurrentTimestamp(),
  rawPrompt: "add input validation to reject negative amounts",
  status: "linked",
  linkedCommit: "deadbeef1234567890abcdef1234567890abcdef",
  aiTool: "claude-code",
};
await fs.writeFile(
  path.join(repoRoot, ".audit", "events", `${event.id}.json`),
  JSON.stringify(event, null, 2)
);

const context: AuditContext = {
  promptEvent: event,
  commitHash: "deadbeef1234567890abcdef1234567890abcdef",
  functionName: "validatePaymentAmount",
  file: "src/payments/validator.ts",
  startLine: 10,
  endLine: 35,
  rawDiff: `@@ -10,8 +10,17 @@ export function validatePaymentAmount(amount: number): void {
-  // no validation
+  if (typeof amount !== "number" || isNaN(amount)) {
+    throw new TypeError("amount must be a valid number");
+  }
+  if (amount <= 0) {
+    throw new RangeError(\`amount must be positive, got \${amount}\`);
+  }
+  if (amount > 1_000_000) {
+    throw new RangeError("amount exceeds maximum allowed value");
+  }
 }`,
  priorAuditHistory: [],
  priorFunctionRecord: undefined,
  cobaseConventions: [],
};

console.log("Calling Claude to generate audit card...\n");
const card = await generateAuditCard(context, repoRoot);

console.log("AuditCard returned:");
console.log(JSON.stringify(card, null, 2));

// Verify required fields
const requiredFields = ["what", "decisions", "risks", "testssuggested", "trustStatus"] as const;
const missing = requiredFields.filter((f) => card[f] === undefined);
if (missing.length > 0) {
  console.error("\nMissing fields:", missing);
  process.exit(1);
}
console.log("\nAll required fields present.");

// Step 5 — card storage
console.log("\n--- Step 5: Card storage ---");
const cardPath = await saveAuditCard(card, repoRoot);
console.log(`Saved audit card to: ${cardPath}`);

await saveOrUpdateFunctionRecord(card, repoRoot);
console.log("Saved function record.");

const record = await loadFunctionRecord("validatePaymentAmount", "src/payments/validator.ts", repoRoot);
console.log("\nLoaded FunctionRecord:");
console.log(JSON.stringify(record, null, 2));
