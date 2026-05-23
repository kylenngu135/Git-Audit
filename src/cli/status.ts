import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "node:url";
import { findRepoRoot } from "../shared/eventStore.js";
import { getFunctionsDir } from "../shared/utils.js";
import type { FunctionRecord } from "../shared/types.js";

type OpenRisk = FunctionRecord["openRisks"][number] & { resolvedByPromptId?: string };
type Record = Omit<FunctionRecord, "openRisks"> & { openRisks: OpenRisk[] };

const SEP = "─────────────────────────────────────────";

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
      "No audit records found. Have you committed any AI-generated code with prompt-audit running?"
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
      "No audit records found. Have you committed any AI-generated code with prompt-audit running?"
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

  console.log(SEP);
  console.log("prompt-audit status");
  console.log(SEP);
  console.log(`Functions audited:   ${totalFunctions}`);
  console.log(`Unverified:          ${unverified}`);
  console.log(`Avg trust score:     ${averageTrustScore}/100`);
  console.log(SEP);
  console.log("Open risks:");
  console.log(`  🔴 High:    ${highRisks}`);
  console.log(`  🟡 Medium:  ${mediumRisks}`);
  console.log(SEP);

  // Functions with high risks
  const highRiskFunctions = records.filter((r) =>
    r.openRisks.some((risk) => !risk.resolvedByPromptId && risk.severity === "high")
  );

  if (highRiskFunctions.length > 0) {
    console.log("Functions requiring attention:");
    for (const record of highRiskFunctions) {
      const activeHigh = record.openRisks.filter(
        (r) => !r.resolvedByPromptId && r.severity === "high"
      );
      console.log(
        `  ⚠  ${record.functionName} (${record.file}) — ${activeHigh.length} high risk(s)`
      );
      for (const risk of activeHigh) {
        console.log(`       • ${risk.message}`);
      }
    }
    console.log();
  }

  // All functions sorted by trust score ascending
  const sorted = [...records].sort((a, b) => a.trustScore - b.trustScore);
  console.log("All audited functions (lowest trust first):");
  for (const record of sorted) {
    console.log(`  [${record.trustScore}/100] ${record.functionName} — ${record.file}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runStatus().catch((err: unknown) => {
    console.error("prompt-audit error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
