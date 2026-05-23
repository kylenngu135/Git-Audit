#!/usr/bin/env node
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { findRepoRoot } from "../shared/eventStore.js";
import { detectConflicts, saveConflictReport } from "./conflictAnalyzer.js";
import {
  presentConflict,
  promptForResolution,
  saveResolutions,
} from "./conflictResolver.js";

const execAsync = promisify(exec);
const SEP = "─────────────────────────────────────────";

async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd });
  return stdout.trim();
}

export async function runAuditMerge(
  branchA?: string,
  branchB?: string
): Promise<void> {
  // Step 1 — Resolve branch names
  const cwd = process.cwd();

  if (!branchA) {
    process.stdout.write(
      "Usage: audit merge <source-branch> [target-branch]\n" +
        "       target-branch defaults to current branch\n"
    );
    return;
  }

  if (!branchB) {
    branchB = await getCurrentBranch(cwd);
  }

  // Step 2 — Find repo root
  const repoRoot = await findRepoRoot(cwd);

  // Step 3 — Check for audit histories
  process.stdout.write(
    `Checking audit histories for conflicts between ${branchA} and ${branchB}...\n`
  );
  const conflicts = await detectConflicts(branchA, branchB, repoRoot);

  // Step 4 — Handle no conflicts
  if (conflicts.length === 0) {
    process.stdout.write(
      `✓ No audit conflicts detected between ${branchA} and ${branchB}\n` +
        `  Note: git may still have code-level conflicts to resolve separately.\n`
    );
    return;
  }

  // Step 5 — Report conflicts found
  process.stdout.write(
    `⚠  ${conflicts.length} audit conflict(s) detected\n` +
      `   These are design-level conflicts that git cannot see.\n` +
      `   Code may merge cleanly but design intents contradict.\n`
  );
  const reportPath = await saveConflictReport(conflicts, branchA, branchB, repoRoot);
  process.stdout.write(`   Full report saved to: ${reportPath}\n`);

  // Step 6 — Interactive resolution
  process.stdout.write(
    `${SEP}\n` +
      `Resolve each conflict before merging.\n` +
      `Your decisions will be recorded in audit history.\n` +
      `${SEP}\n`
  );

  const resolutions = [];
  for (let i = 0; i < conflicts.length; i++) {
    presentConflict(conflicts[i], i + 1, conflicts.length);
    const resolution = await promptForResolution(conflicts[i], branchA, branchB);
    resolutions.push(resolution);
  }

  // Step 7 — Save all resolutions
  await saveResolutions(resolutions, branchA, branchB, repoRoot);
  process.stdout.write(
    `${SEP}\n` +
      `Audit conflict resolution complete.\n` +
      `You can now proceed with: git merge ${branchA}\n` +
      `${SEP}\n`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const branchA = process.argv[2];
  const branchB = process.argv[3];
  runAuditMerge(branchA, branchB).catch((err) => {
    process.stderr.write(`audit merge error: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
