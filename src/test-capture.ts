import fs from "node:fs/promises";
import path from "node:path";
import { savePromptEvent, findRepoRoot } from "./shared/eventStore.js";
import { generateId, getCurrentTimestamp, getEventsDir } from "./shared/utils.js";
import type { PromptEvent } from "./shared/types.js";

const event: PromptEvent = {
  id: generateId(),
  timestamp: getCurrentTimestamp(),
  rawPrompt: "test prompt: add retry logic to auth handler",
  status: "pending",
  linkedCommit: undefined,
  aiTool: "claude-code",
  intention: undefined,
  responseSummary: undefined,
  filesChanged: undefined,
};

const filePath = await savePromptEvent(event);
console.log("Saved to:", filePath);

const repoRoot = await findRepoRoot(process.cwd());
const savedRaw = await fs.readFile(path.join(getEventsDir(repoRoot), `${event.id}.json`), "utf-8");
console.log("File contents:");
console.log(savedRaw);
