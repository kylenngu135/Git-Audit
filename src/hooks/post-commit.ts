import path from "path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { findRepoRoot, listPendingEvents, updatePromptEvent } from "../shared/eventStore.js";
import { getCurrentCommitHash, getDiffHunks, getChangedFiles } from "../shared/gitUtils.js";
import { parseDiff, filterSignificantHunks, groupHunksByFile } from "../shared/diffParser.js";
import { getFunctionsChangedInCommit } from "../shared/functionDetector.js";
import { runAuditOrchestrator } from "../audit/orchestrator.js";

export async function runPostCommitHook(): Promise<void> {
  // Step 1 — Find repo root
  let repoRoot: string;
  try {
    repoRoot = await findRepoRoot(process.cwd());
  } catch {
    process.stderr.write("prompt-audit: not in a git repo, skipping\n");
    return;
  }

  // Step 2 — Get the current commit hash
  const commitHash = await getCurrentCommitHash(repoRoot);

  // Step 3 — Find the most recent pending prompt event
  const pendingEvents = await listPendingEvents(repoRoot);
  if (pendingEvents.length === 0) {
    process.stderr.write(
      "prompt-audit: no pending prompt event found for this commit. Skipping audit. Did you forget to use capture_prompt?\n"
    );
    return;
  }

  // Step 4 — Link the prompt event to this commit
  const event = pendingEvents[pendingEvents.length - 1];
  await updatePromptEvent(event.id, { status: "linked", linkedCommit: commitHash }, repoRoot);

  // Step 5 — Extract the diff
  const rawDiff = await getDiffHunks(repoRoot);
  const allHunks = parseDiff(rawDiff);
  const filteredHunks = filterSignificantHunks(allHunks);
  if (filteredHunks.length === 0) {
    process.stderr.write(
      "prompt-audit: no significant code changes detected, skipping function analysis\n"
    );
    return;
  }

  // Step 6 — Detect changed functions
  const changedFiles = await getChangedFiles(repoRoot);
  const functionsChanged = await getFunctionsChangedInCommit(changedFiles, filteredHunks, repoRoot);
  for (const [functionName, fn] of functionsChanged) {
    process.stderr.write(
      `prompt-audit: detected change in function: ${functionName} in ${fn.file}\n`
    );
  }

  // Step 7 — Save the changeset summary
  const changeset = {
    promptEventId: event.id,
    commitHash,
    timestamp: new Date().toISOString(),
    functionsChanged: [...functionsChanged.entries()].map(([functionName, fn]) => ({
      functionName,
      file: fn.file,
      startLine: fn.startLine,
      endLine: fn.endLine,
      hunkCount: fn.hunks.length,
    })),
  };

  const changesetPath = path.join(
    repoRoot,
    ".audit",
    "events",
    `${event.id}-changeset.json`
  );
  await fs.writeFile(changesetPath, JSON.stringify(changeset, null, 2));

  process.stderr.write(
    `prompt-audit: changeset saved. ${functionsChanged.size} function(s) detected.\n`
  );

  // Step 8 — Trigger audit card generation
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write(
      `prompt-audit: ANTHROPIC_API_KEY not set, skipping audit card generation. Set it and run: node --import tsx/esm src/audit/orchestrator.ts ${event.id}\n`
    );
    return;
  }

  process.stderr.write("prompt-audit: generating audit cards via Claude...\n");
  try {
    await runAuditOrchestrator(event.id, repoRoot);
  } catch (err) {
    process.stderr.write(
      `prompt-audit: audit card generation failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }
  process.stderr.write("prompt-audit: done. Run 'audit show' to see results.\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPostCommitHook().catch((err: unknown) => {
    process.stderr.write(
      `prompt-audit error: ${err instanceof Error ? err.message : String(err)}\n`
    );
  });
}
