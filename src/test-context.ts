import fs from "node:fs/promises";
import path from "node:path";
import { findRepoRoot, savePromptEvent } from "./shared/eventStore.js";
import { generateId, getCurrentTimestamp } from "./shared/utils.js";
import { buildAuditContext, loadChangeset } from "./audit/contextBuilder.js";
import type { PromptEvent } from "./shared/types.js";

const repoRoot = await findRepoRoot(process.cwd());
const eventsDir = path.join(repoRoot, ".audit", "events");

// Create fake linked PromptEvent
const event: PromptEvent = {
  id: generateId(),
  timestamp: getCurrentTimestamp(),
  rawPrompt: "add input validation to reject negative amounts in the payment handler",
  status: "linked",
  linkedCommit: "abc1234567890abcdef1234567890abcdef123456",
  aiTool: "claude-code",
};
await savePromptEvent(event);
// savePromptEvent writes with status "pending" internally — overwrite with linked
await fs.writeFile(
  path.join(eventsDir, `${event.id}.json`),
  JSON.stringify(event, null, 2)
);
console.log(`Created event: ${event.id}`);

// Create fake changeset
const changeset = {
  promptEventId: event.id,
  commitHash: "abc1234567890abcdef1234567890abcdef123456",
  timestamp: getCurrentTimestamp(),
  functionsChanged: [
    {
      functionName: "testFunction",
      file: "src/test.ts",
      startLine: 1,
      endLine: 20,
      hunkCount: 1,
    },
  ],
};
const changesetPath = path.join(eventsDir, `${event.id}-changeset.json`);
await fs.writeFile(changesetPath, JSON.stringify(changeset, null, 2));
console.log(`Created changeset: ${changesetPath}`);

// Build context
const context = await buildAuditContext(
  event.id,
  "testFunction",
  "src/test.ts",
  1,
  20,
  "",
  repoRoot
);

console.log("\nAuditContext:");
console.log(JSON.stringify(context, null, 2));

// Verify no undefined fields (except priorFunctionRecord)
const required: (keyof typeof context)[] = [
  "promptEvent",
  "commitHash",
  "functionName",
  "file",
  "startLine",
  "endLine",
  "rawDiff",
  "priorAuditHistory",
  "cobaseConventions",
];
const missing = required.filter((k) => context[k] === undefined);
if (missing.length > 0) {
  console.error("\nMissing fields:", missing);
  process.exit(1);
} else {
  console.log("\nAll required fields present. priorFunctionRecord:", context.priorFunctionRecord);
}

// Export event id for use by test-audit
console.log(`\nEVENT_ID=${event.id}`);
