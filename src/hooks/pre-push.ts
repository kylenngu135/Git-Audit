import path from "path";
import fs from "fs/promises";
import { findRepoRoot } from "../shared/eventStore.js";
import { getFunctionsDir } from "../shared/utils.js";
import type { FunctionRecord } from "../shared/types.js";

type OpenRisk = FunctionRecord["openRisks"][number] & { resolvedByPromptId?: string };
type ExtendedRecord = Omit<FunctionRecord, "openRisks"> & { openRisks: OpenRisk[] };

export async function runPrePushHook(): Promise<void> {
  // Step 1 — Find repo root (never block a push due to audit errors)
  let repoRoot: string;
  try {
    repoRoot = await findRepoRoot(process.cwd());
  } catch {
    process.exit(0);
  }

  // Step 2 — Load all function records
  const functionsDir = getFunctionsDir(repoRoot);
  let recordFiles: string[] = [];
  try {
    const entries = await fs.readdir(functionsDir);
    recordFiles = entries.filter((e) => e.endsWith("_record.json"));
  } catch {
    process.exit(0);
  }

  if (recordFiles.length === 0) process.exit(0);

  const records: ExtendedRecord[] = [];
  for (const filename of recordFiles) {
    try {
      const raw = await fs.readFile(path.join(functionsDir, filename), "utf-8");
      records.push(JSON.parse(raw) as ExtendedRecord);
    } catch {
      // skip unreadable records
    }
  }

  if (records.length === 0) process.exit(0);

  // Step 3 — Find functions that need attention
  const concerning = records.filter((r) => {
    const hasHighRisk = r.openRisks.some(
      (risk) => risk.severity === "high" && !risk.resolvedByPromptId
    );
    return hasHighRisk || r.trustScore < 50;
  });

  // Step 4 — Nothing concerning, exit cleanly
  if (concerning.length === 0) process.exit(0);

  // Step 5 — Print warning
  const BOX = 53;
  const IND = "  ";
  const boxLine = (text: string) => `│  ${text.padEnd(BOX - 2)}│`;

  process.stderr.write(`┌${"─".repeat(BOX)}┐\n`);
  process.stderr.write(`${boxLine("git-audit — pre-push warning")}\n`);
  process.stderr.write(`└${"─".repeat(BOX)}┘\n`);
  process.stderr.write(`\n${IND}⚠  ${concerning.length} function(s) have unresolved issues:\n\n`);

  for (const record of concerning) {
    const highRisks = record.openRisks.filter(
      (r) => r.severity === "high" && !r.resolvedByPromptId
    );
    process.stderr.write(`${IND}🔴 ${record.functionName} (${record.file})\n`);
    process.stderr.write(`${IND}   Trust score: ${record.trustScore}/100\n`);
    if (highRisks.length > 0) {
      process.stderr.write(`${IND}   Open high risks:\n`);
      for (const risk of highRisks) {
        process.stderr.write(`${IND}   • ${risk.message}\n`);
      }
    }
    process.stderr.write("\n");
  }

  process.stderr.write(`${IND}${"─".repeat(BOX)}\n`);
  process.stderr.write(`${IND}These are AI-generated functions that have not been\n`);
  process.stderr.write(`${IND}fully verified. Consider reviewing before pushing.\n`);
  process.stderr.write("\n");
  process.stderr.write(`${IND}Options:\n`);
  process.stderr.write(`${IND}[1] Push anyway    — git push (run without this hook)\n`);
  process.stderr.write(`${IND}[2] Review first   — run 'audit show <function>'\n`);
  process.stderr.write(`${IND}[3] Abort          — press Ctrl+C\n`);
  process.stderr.write("\n");
  process.stdout.write(`${IND}Push anyway? (y/N): `);

  // Read a single character from stdin
  const answer = await new Promise<string>((resolve) => {
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (chunk) => {
      process.stdin.pause();
      resolve(String(chunk).trim()[0] ?? "");
    });
    process.stdin.once("end", () => resolve(""));
    process.stdin.once("error", () => resolve(""));
    process.stdin.resume();
  });

  if (answer === "y" || answer === "Y") {
    process.stderr.write("Pushing...\n");
    process.exit(0);
  } else {
    process.stderr.write("Push aborted. Review with 'audit show <function>'\n");
    process.exit(1);
  }
}

// Step 6 — Never block push due to audit system errors
runPrePushHook().catch(() => {
  process.exit(0);
});
