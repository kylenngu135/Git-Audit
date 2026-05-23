import path from "path";
import fs from "fs/promises";
import readline from "readline";
import { exec } from "child_process";
import { promisify } from "util";
import type { AuditConflict, ConflictResolution } from "./conflictAnalyzer.js";
import { findRepoRoot, savePromptEvent } from "../shared/eventStore.js";
import { generateId, getCurrentTimestamp } from "../shared/utils.js";
import type { PromptEvent } from "../shared/types.js";

const execAsync = promisify(exec);
const SEP = "─────────────────────────────────────────";

function severityEmoji(severity: "low" | "medium" | "high"): string {
  if (severity === "high") return "🔴";
  if (severity === "medium") return "🟡";
  return "🟢";
}

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

export function presentConflict(
  conflict: AuditConflict,
  index: number,
  total: number
): void {
  process.stdout.write(
    [
      SEP,
      `Audit conflict ${index} of ${total}`,
      SEP,
      `Function:  ${conflict.functionName}`,
      `File:      ${conflict.file}`,
      `Type:      ${conflict.conflictType}`,
      `Severity:  ${severityEmoji(conflict.severity)} ${conflict.severity}`,
      SEP,
      `Branch "${conflict.branchA}" intent:`,
      `  ${conflict.branchAIntent}`,
      ``,
      `Branch "${conflict.branchB}" intent:`,
      `  ${conflict.branchBIntent}`,
      ``,
      `Why this conflicts:`,
      `  ${conflict.explanation}`,
      SEP,
      ``,
    ].join("\n")
  );
}

export async function promptForResolution(
  conflict: AuditConflict,
  branchA: string,
  branchB: string
): Promise<ConflictResolution> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  process.stdout.write(
    `How do you want to resolve this conflict?\n` +
      `[1] Accept "${branchA}" design intent\n` +
      `[2] Accept "${branchB}" design intent\n` +
      `[3] Write a custom resolution\n` +
      `[s] Skip this conflict for now\n\n`
  );

  const rawChoice = await ask(rl, "> ");
  const choice = rawChoice.trim().toLowerCase()[0] ?? "s";

  let resolution: string;

  if (choice === "1") {
    resolution = `Accepted ${branchA} design: ${conflict.branchAIntent}`;
  } else if (choice === "2") {
    resolution = `Accepted ${branchB} design: ${conflict.branchBIntent}`;
  } else if (choice === "3") {
    const custom = await ask(rl, "Enter your resolution intent: ");
    resolution = custom.trim();
  } else {
    resolution = "SKIPPED";
  }

  rl.close();

  let resolvedByDeveloper = "unknown";
  try {
    const { stdout } = await execAsync("git config user.name");
    resolvedByDeveloper = stdout.trim() || "unknown";
  } catch {
    // leave as "unknown"
  }

  const updatedConflict: AuditConflict = { ...conflict };

  if (resolution !== "SKIPPED") {
    const event: PromptEvent = {
      id: generateId(),
      timestamp: getCurrentTimestamp(),
      rawPrompt: `MERGE RESOLUTION: ${resolution}`,
      aiTool: "human",
      status: "audited",
      linkedCommit: undefined,
    };
    await savePromptEvent(event);
    updatedConflict.resolvedBy = event.id;
  }

  return {
    conflict: updatedConflict,
    resolution,
    resolvedAt: getCurrentTimestamp(),
    resolvedByDeveloper,
  };
}

export async function saveResolutions(
  resolutions: ConflictResolution[],
  branchA: string,
  branchB: string,
  repoRoot: string
): Promise<void> {
  const nonSkipped = resolutions.filter((r) => r.resolution !== "SKIPPED");

  if (nonSkipped.length > 0) {
    const conflictsDir = path.join(repoRoot, ".audit", "conflicts");
    await fs.mkdir(conflictsDir, { recursive: true });

    const safeBranchA = branchA.replace(/\//g, "_");
    const safeBranchB = branchB.replace(/\//g, "_");
    for (const resolution of nonSkipped) {
      const id = generateId();
      const filename = `${safeBranchA}-vs-${safeBranchB}-resolution-${id}.json`;
      await fs.writeFile(
        path.join(conflictsDir, filename),
        JSON.stringify(resolution, null, 2)
      );
    }
  }

  process.stdout.write(`✓ ${nonSkipped.length} resolution(s) recorded in audit history\n`);
}
