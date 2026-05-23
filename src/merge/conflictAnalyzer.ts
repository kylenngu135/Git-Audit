import path from "path";
import fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import type { AuditCard, FunctionRecord } from "../shared/types.js";
import { findRepoRoot } from "../shared/eventStore.js";
import { getFunctionsDir } from "../shared/utils.js";

const execAsync = promisify(exec);

async function runGitCommand(command: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(command, { cwd });
    return stdout.trim();
  } catch (err: unknown) {
    const stderr = (err as { stderr?: string }).stderr?.trim() ?? "";
    throw new Error(`git command failed: \`${command}\`\n${stderr}`);
  }
}

export type ConflictType =
  | "direct-opposition"
  | "philosophical-tension"
  | "risk-collision"
  | "convention-drift";

export interface AuditConflict {
  functionName: string;
  file: string;
  conflictType: ConflictType;
  branchA: string;
  branchB: string;
  branchAIntent: string;
  branchBIntent: string;
  explanation: string;
  severity: "low" | "medium" | "high";
  resolvedBy: string | undefined;
}

export interface ConflictResolution {
  conflict: AuditConflict;
  resolution: string;
  resolvedAt: string;
  resolvedByDeveloper: string;
}

export async function getFunctionsOnBranch(
  branchName: string,
  repoRoot: string
): Promise<Map<string, FunctionRecord>> {
  const map = new Map<string, FunctionRecord>();

  let allFiles: string;
  try {
    allFiles = await runGitCommand(
      `git ls-tree -r --name-only ${branchName}`,
      repoRoot
    );
  } catch {
    return map;
  }

  const recordFiles = allFiles
    .split("\n")
    .filter((f) => f.includes(".audit/functions/") && f.endsWith("_record.json"));

  for (const filePath of recordFiles) {
    try {
      const content = await runGitCommand(
        `git show ${branchName}:${filePath}`,
        repoRoot
      );
      const record = JSON.parse(content) as FunctionRecord;
      map.set(record.functionName, record);
    } catch {
      // skip unreadable or malformed records
    }
  }

  return map;
}

export async function detectConflicts(
  branchA: string,
  branchB: string,
  repoRoot: string
): Promise<AuditConflict[]> {
  const [mapA, mapB] = await Promise.all([
    getFunctionsOnBranch(branchA, repoRoot),
    getFunctionsOnBranch(branchB, repoRoot),
  ]);

  const conflicts: AuditConflict[] = [];

  for (const [functionName, recordA] of mapA) {
    const recordB = mapB.get(functionName);
    if (!recordB) continue;

    const conflict = await analyzeForConflict(
      functionName,
      recordA,
      recordB,
      branchA,
      branchB,
      repoRoot
    );
    if (conflict) {
      conflicts.push(conflict);
    }
  }

  return conflicts;
}

export async function analyzeForConflict(
  functionName: string,
  recordA: FunctionRecord,
  recordB: FunctionRecord,
  branchA: string,
  branchB: string,
  repoRoot: string
): Promise<AuditConflict | null> {
  if (recordA.auditHistory.length === 0 || recordB.auditHistory.length === 0) {
    return null;
  }

  const lastEntryA = recordA.auditHistory[recordA.auditHistory.length - 1];
  const lastEntryB = recordB.auditHistory[recordB.auditHistory.length - 1];

  const relCardRefA = path.relative(repoRoot, lastEntryA.cardRef);
  const relCardRefB = path.relative(repoRoot, lastEntryB.cardRef);

  let cardA: AuditCard;
  let cardB: AuditCard;

  try {
    const rawA = await runGitCommand(`git show ${branchA}:${relCardRefA}`, repoRoot);
    cardA = JSON.parse(rawA) as AuditCard;
  } catch {
    return null;
  }

  try {
    const rawB = await runGitCommand(`git show ${branchB}:${relCardRefB}`, repoRoot);
    cardB = JSON.parse(rawB) as AuditCard;
  } catch {
    return null;
  }

  const file = recordA.file;
  const candidates: AuditConflict[] = [];

  // Use intention + responseSummary as the signal text for each card
  const aText = `${cardA.intention ?? ""} ${cardA.responseSummary ?? ""}`.toLowerCase();
  const bText = `${cardB.intention ?? ""} ${cardB.responseSummary ?? ""}`.toLowerCase();

  // ── Direct opposition ─────────────────────────────────────────────────────
  const opposingPairs: [string, string][] = [
    ["cache", "no-cache"],
    ["always", "never"],
    ["sync", "async"],
    ["strict", "lenient"],
    ["throw", "return null"],
    ["validate", "skip"],
    ["encrypt", "plain"],
    ["log", "silent"],
  ];

  for (const [kwX, kwY] of opposingPairs) {
    const aHasX = aText.includes(kwX);
    const aHasY = aText.includes(kwY);
    const bHasX = bText.includes(kwX);
    const bHasY = bText.includes(kwY);

    const forwardConflict = aHasX && bHasY;
    const reverseConflict = aHasY && bHasX;

    if (forwardConflict || reverseConflict) {
      const [aKw, bKw] = forwardConflict ? [kwX, kwY] : [kwY, kwX];
      candidates.push({
        functionName,
        file,
        conflictType: "direct-opposition",
        branchA,
        branchB,
        branchAIntent: cardA.intention ?? "",
        branchBIntent: cardB.intention ?? "",
        explanation:
          `Branch ${branchA} uses "${aKw}" while branch ${branchB} uses "${bKw}" ` +
          `for the same function — these are direct design opposites.`,
        severity: "high",
        resolvedBy: undefined,
      });
      break;
    }
  }

  // ── Philosophical tension ─────────────────────────────────────────────────
  const performanceKeywords = ["cache", "fast", "optimize", "lazy", "batch", "parallel"];
  const correctnessKeywords = ["validate", "verify", "strict", "always", "every", "safe"];
  const criticalPathPatterns = ["payment", "auth", "security", "core", "api"];

  const isCriticalPath = criticalPathPatterns.some((p) => file.toLowerCase().includes(p));

  if (isCriticalPath) {
    const aIsPerf = performanceKeywords.some((kw) => aText.includes(kw));
    const aIsCorrect = correctnessKeywords.some((kw) => aText.includes(kw));
    const bIsPerf = performanceKeywords.some((kw) => bText.includes(kw));
    const bIsCorrect = correctnessKeywords.some((kw) => bText.includes(kw));

    const aOrientation =
      aIsPerf && !aIsCorrect ? "performance" : aIsCorrect && !aIsPerf ? "correctness" : null;
    const bOrientation =
      bIsPerf && !bIsCorrect ? "performance" : bIsCorrect && !bIsPerf ? "correctness" : null;

    if (aOrientation && bOrientation && aOrientation !== bOrientation) {
      candidates.push({
        functionName,
        file,
        conflictType: "philosophical-tension",
        branchA,
        branchB,
        branchAIntent: cardA.intention ?? "",
        branchBIntent: cardB.intention ?? "",
        explanation:
          `Branch ${branchA} takes a ${aOrientation} approach while branch ${branchB} ` +
          `takes a ${bOrientation} approach to this critical path function in ${file}.`,
        severity: "medium",
        resolvedBy: undefined,
      });
    }
  }

  // ── Convention drift ──────────────────────────────────────────────────────
  const aUsesTryCatch = aText.includes("try/catch") || aText.includes("catch") || aText.includes("exception");
  const aUsesReturnNull = aText.includes("return null") || aText.includes("undefined") || aText.includes("falsy");
  const bUsesTryCatch = bText.includes("try/catch") || bText.includes("catch") || bText.includes("exception");
  const bUsesReturnNull = bText.includes("return null") || bText.includes("undefined") || bText.includes("falsy");

  const aDominant =
    aUsesTryCatch && !aUsesReturnNull
      ? "try/catch"
      : aUsesReturnNull && !aUsesTryCatch
      ? "return null/undefined"
      : null;
  const bDominant =
    bUsesTryCatch && !bUsesReturnNull
      ? "try/catch"
      : bUsesReturnNull && !bUsesTryCatch
      ? "return null/undefined"
      : null;

  if (aDominant && bDominant && aDominant !== bDominant) {
    candidates.push({
      functionName,
      file,
      conflictType: "convention-drift",
      branchA,
      branchB,
      branchAIntent: cardA.intention ?? "",
      branchBIntent: cardB.intention ?? "",
      explanation:
        `Branch ${branchA} uses ${aDominant} while branch ${branchB} uses ${bDominant} ` +
        `for error handling in the same function — merging will produce inconsistent error handling conventions.`,
      severity: "low",
      resolvedBy: undefined,
    });
  }

  if (candidates.length === 0) return null;

  const severityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  return candidates.sort((a, b) => severityRank[b.severity] - severityRank[a.severity])[0];
}

export async function saveConflictReport(
  conflicts: AuditConflict[],
  branchA: string,
  branchB: string,
  repoRoot: string
): Promise<string> {
  const conflictsDir = path.join(repoRoot, ".audit", "conflicts");
  await fs.mkdir(conflictsDir, { recursive: true });

  const safeBranchA = branchA.replace(/\//g, "_");
  const safeBranchB = branchB.replace(/\//g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${safeBranchA}-vs-${safeBranchB}-${timestamp}.json`;
  const filePath = path.join(conflictsDir, filename);

  await fs.writeFile(filePath, JSON.stringify(conflicts, null, 2));
  return filePath;
}
