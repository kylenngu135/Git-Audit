import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "node:url";
import {
  findRepoRoot,
  listPendingEvents,
  loadPromptEvent,
  updatePromptEvent,
} from "../shared/eventStore.js";
import { loadChangeset, buildAuditContext } from "./contextBuilder.js";
import { generateAuditCard } from "./cardGenerator.js";
import { saveAuditCard, saveOrUpdateFunctionRecord } from "./cardStore.js";

type ChangesetFunction = {
  functionName: string;
  file: string;
  startLine: number;
  endLine: number;
  hunkCount: number;
  rawContent?: string;
};

async function findMostRecentLinkedEvent(
  repoRoot: string
): Promise<string | undefined> {
  const eventsDir = path.join(repoRoot, ".audit", "events");
  let entries: string[];
  try {
    entries = await fs.readdir(eventsDir);
  } catch {
    return undefined;
  }

  const linked: Array<{ id: string; timestamp: string }> = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry.endsWith("-changeset.json")) continue;
    try {
      const raw = await fs.readFile(path.join(eventsDir, entry), "utf-8");
      const event = JSON.parse(raw) as { id: string; status: string; timestamp: string };
      if (event.status === "linked") {
        linked.push({ id: event.id, timestamp: event.timestamp });
      }
    } catch {
      // skip unreadable or malformed files
    }
  }

  if (linked.length === 0) return undefined;
  linked.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return linked[0].id;
}

export async function runAuditOrchestrator(
  eventId?: string,
  repoRoot?: string
): Promise<void> {
  // Resolve repo root
  const root = repoRoot ?? (await findRepoRoot(process.cwd()));

  // Resolve event ID
  let targetEventId = eventId;
  if (!targetEventId) {
    targetEventId = await findMostRecentLinkedEvent(root);
    if (!targetEventId) {
      process.stderr.write(
        "git-audit: no linked prompt events found to audit. Run after committing AI-generated code.\n"
      );
      return;
    }
  }

  // Load changeset
  const changeset = await loadChangeset(targetEventId, root) as {
    promptEventId: string;
    commitHash: string;
    functionsChanged?: ChangesetFunction[];
  };

  if (!changeset.functionsChanged || changeset.functionsChanged.length === 0) {
    process.stderr.write("git-audit: no functions to audit in this changeset\n");
    return;
  }

  // Load prompt event for log message
  const promptEvent = await loadPromptEvent(targetEventId, root);
  const preview = promptEvent.rawPrompt.slice(0, 60);

  process.stderr.write(
    `git-audit: starting audit for ${changeset.functionsChanged.length} function(s) from prompt: ${preview}...\n`
  );

  // Process each function sequentially
  for (const fn of changeset.functionsChanged) {
    process.stderr.write(`git-audit: auditing ${fn.functionName} in ${fn.file}...\n`);

    try {
      // Use rawContent from changeset if available, otherwise empty string
      const rawDiff = fn.rawContent ?? "";

      const context = await buildAuditContext(
        targetEventId,
        fn.functionName,
        fn.file,
        fn.startLine,
        fn.endLine,
        rawDiff,
        root
      );

      const card = await generateAuditCard(context, root);

      const cardPath = await saveAuditCard(card, root);

      await saveOrUpdateFunctionRecord(card, root);

      process.stderr.write(
        `git-audit: ✓ ${fn.functionName} — ${card.risks.length} risk(s) found, trust score saved\n`
      );
    } catch (err) {
      process.stderr.write(
        `git-audit: error auditing ${fn.functionName}: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
  }

  // Mark event as audited
  await updatePromptEvent(targetEventId, { status: "audited" }, root);

  process.stderr.write("git-audit: audit complete. Cards saved to .audit/functions/\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const eventId = process.argv[2];
  runAuditOrchestrator(eventId).catch((err) => {
    console.error("git-audit error:", (err as Error).message);
    process.exit(1);
  });
}
