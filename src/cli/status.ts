import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "node:url";
import { findRepoRoot } from "../shared/eventStore.js";
import { getFunctionsDir } from "../shared/utils.js";
import type { FunctionRecord } from "../shared/types.js";

type OpenRisk = FunctionRecord["openRisks"][number] & { resolvedByPromptId?: string };
type Record = Omit<FunctionRecord, "openRisks"> & { openRisks: OpenRisk[] };


async function loadLatestTrustStatus(
  record: Record,
  functionsDir: string
): Promise<"unverified" | "verified" | "flagged"> {
  if (record.auditHistory.length === 0) return "unverified";
  const latest = record.auditHistory[record.auditHistory.length - 1];
  try {
    const raw = await fs.readFile(latest.cardRef, "utf-8");
    const card = JSON.parse(raw) as { trustStatus: "unverified" | "verified" | "flagged" };
    return card.trustStatus;
  } catch {
    return "unverified";
  }
}

export async function runStatus(): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  const functionsDir = getFunctionsDir(repoRoot);

  let entries: string[];
  try {
    entries = await fs.readdir(functionsDir);
  } catch {
    entries = [];
  }

  const recordFiles = entries.filter((e) => e.endsWith("_record.json"));

  if (recordFiles.length === 0) {
    console.log(
      "No audit records found. Have you committed any AI-generated code with git-audit running?"
    );
    return;
  }

  const records: Record[] = [];
  for (const filename of recordFiles) {
    try {
      const raw = await fs.readFile(path.join(functionsDir, filename), "utf-8");
      records.push(JSON.parse(raw) as Record);
    } catch {
      // skip unreadable records
    }
  }

  if (records.length === 0) {
    console.log(
      "No audit records found. Have you committed any AI-generated code with git-audit running?"
    );
    return;
  }

  // Compute summary stats
  let unverified = 0;
  for (const record of records) {
    const status = await loadLatestTrustStatus(record, functionsDir);
    if (status === "unverified") unverified++;
  }

  const totalFunctions = records.length;

  let highRisks = 0;
  let mediumRisks = 0;
  for (const record of records) {
    for (const risk of record.openRisks) {
      if (risk.resolvedByPromptId) continue;
      if (risk.severity === "high") highRisks++;
      else if (risk.severity === "medium") mediumRisks++;
    }
  }

  const averageTrustScore = Math.round(
    records.reduce((sum, r) => sum + r.trustScore, 0) / records.length
  );

  // ── Display ─────────────────────────────────────────
  const BOX = 53;
  const INDENT = "  ";

  const stat = (label: string, value: string) =>
    `${INDENT}${label.padEnd(22)}${value}`;

  const section = (title: string) =>
    `\n${INDENT}${title}\n${INDENT}${"─".repeat(title.length)}`;

  const colorScore = (score: number, text: string) => {
    const code = score >= 80 ? "\x1b[32m" : score >= 50 ? "\x1b[33m" : "\x1b[31m";
    return `${code}${text}\x1b[0m`;
  };

  // Header box
  console.log(`┌${"─".repeat(BOX)}┐`);
  console.log(`│  ${"git-audit — codebase trust report".padEnd(BOX - 2)}│`);
  console.log(`└${"─".repeat(BOX)}┘`);
  console.log();

  // Summary stats
  console.log(stat("Functions audited", String(totalFunctions)));
  console.log(stat("Avg trust score", `${averageTrustScore}/100`));
  console.log(stat("Unverified", String(unverified)));

  // Risk summary
  console.log(section("Risk summary"));
  console.log(`${INDENT}🔴 High      ${highRisks}`);
  console.log(`${INDENT}🟡 Medium    ${mediumRisks}`);

  // Needs attention
  const highRiskFunctions = records.filter((r) =>
    r.openRisks.some((risk) => !risk.resolvedByPromptId && risk.severity === "high")
  );

  if (highRiskFunctions.length > 0) {
    console.log(section("Needs attention"));
    for (const record of highRiskFunctions) {
      const activeHigh = record.openRisks.filter(
        (r) => !r.resolvedByPromptId && r.severity === "high"
      );
      console.log(`\n${INDENT}⚠  ${record.functionName}`);
      console.log(`     ${record.file}`);
      console.log(`     ${activeHigh.length} high risk(s):`);
      for (const risk of activeHigh) {
        console.log(`     • ${risk.message}`);
      }
    }
  }

  // All functions sorted by trust score ascending
  const sorted = [...records].sort((a, b) => a.trustScore - b.trustScore);
  console.log(section("All functions"));
  console.log();
  for (const record of sorted) {
    const scoreLabel = `[${record.trustScore}/100]`;
    const fileIndent = " ".repeat(INDENT.length + scoreLabel.length + 1);
    console.log(`${INDENT}${colorScore(record.trustScore, scoreLabel)} ${record.functionName}`);
    console.log(`${fileIndent}${record.file}`);
  }

  // Footer
  console.log();
  console.log(`${INDENT}Run 'audit show <function>' for full audit history.`);
  console.log(`${INDENT}${"─".repeat(BOX)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runStatus().catch((err: unknown) => {
    console.error("git-audit error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
