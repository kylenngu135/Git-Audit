import path from "path";
import { fileURLToPath } from "url";
import { findRepoRoot, listPendingEvents, updatePromptEvent } from "../shared/eventStore.js";
import { getCurrentCommitHash, getDiffHunks, getChangedFiles } from "../shared/gitUtils.js";
import { parseDiff, filterSignificantHunks } from "../shared/diffParser.js";
import { getFunctionsChangedInCommit } from "../shared/functionDetector.js";
import { saveAuditCard, saveOrUpdateFunctionRecord } from "../audit/cardStore.js";
import { generateId, getCurrentTimestamp } from "../shared/utils.js";
import type { AuditCard } from "../shared/types.js";

export async function runPostCommitHook(): Promise<void> {
  try {
    // STEP A — Find repo root
    let repoRoot: string;
    try {
      repoRoot = await findRepoRoot(process.cwd());
    } catch {
      process.stderr.write("git-audit: not in a git repo, skipping\n");
      return;
    }

    // STEP B — Get current commit hash
    const commitHash = await getCurrentCommitHash(repoRoot);

    // STEP C — Find most recent pending event
    const pendingEvents = await listPendingEvents(repoRoot);
    if (pendingEvents.length === 0) {
      process.stderr.write(
        "git-audit: no pending prompt event found. Did you forget to use capture_prompt?\n"
      );
      return;
    }
    const event = pendingEvents[pendingEvents.length - 1];

    // STEP D — Link event to commit
    await updatePromptEvent(event.id, { status: "linked", linkedCommit: commitHash }, repoRoot);

    // STEP E — Get changed files (prefer event.filesChanged, fallback to git diff)
    let changedFiles: string[];
    if (event.filesChanged && event.filesChanged.length > 0) {
      changedFiles = event.filesChanged;
    } else {
      changedFiles = await getChangedFiles(repoRoot);
    }
    process.stderr.write(`git-audit: changed files: ${changedFiles.join(", ")}\n`);

    // STEP F — Get diff and detect functions
    const rawDiff = await getDiffHunks(repoRoot);
    const allHunks = parseDiff(rawDiff);
    const filteredHunks = filterSignificantHunks(allHunks);

    if (filteredHunks.length === 0) {
      process.stderr.write("git-audit: no significant hunks detected\n");
      return;
    }

    const functionsChanged = await getFunctionsChangedInCommit(
      changedFiles,
      filteredHunks,
      repoRoot
    );
    process.stderr.write(`git-audit: detected ${functionsChanged.size} function(s)\n`);

    if (functionsChanged.size === 0) {
      process.stderr.write("git-audit: no functions detected in diff\n");
      return;
    }

    // STEP G — Generate one card per function
    let cardCount = 0;
    for (const [functionName, fn] of functionsChanged) {
      // Ensure file is repo-relative (getFunctionsChangedInCommit returns absolute paths)
      const relFile = path.isAbsolute(fn.file)
        ? path.relative(repoRoot, fn.file)
        : fn.file;

      const card: AuditCard = {
        id: generateId(),
        promptEventId: event.id,
        commitHash,
        file: relFile,
        functionName,
        prompt: event.rawPrompt.slice(0, 300),
        intention: event.intention?.slice(0, 300) ?? "No intention captured.",
        responseSummary: event.responseSummary?.slice(0, 500) ?? "No response summary captured.",
        createdAt: getCurrentTimestamp(),
      };

      await saveAuditCard(card, repoRoot);
      await saveOrUpdateFunctionRecord(card, repoRoot);
      process.stderr.write(`git-audit: ✓ ${functionName} in ${relFile}\n`);
      cardCount++;
    }

    // STEP H — Mark event as audited
    await updatePromptEvent(event.id, { status: "audited" }, repoRoot);
    process.stderr.write(
      `git-audit: ${cardCount} card(s) saved. Run 'audit show <function>' to view.\n`
    );
  } catch (err) {
    process.stderr.write(
      `git-audit error: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPostCommitHook().catch((err: unknown) => {
    process.stderr.write(
      `git-audit error: ${err instanceof Error ? err.message : String(err)}\n`
    );
  });
}
