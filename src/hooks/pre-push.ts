import path from "path";
import fs from "fs/promises";
import { findRepoRoot } from "../shared/eventStore.js";
import { getFunctionsDir } from "../shared/utils.js";
import type { FunctionRecord } from "../shared/types.js";

export async function runPrePushHook(): Promise<void> {
  let repoRoot: string;
  try {
    repoRoot = await findRepoRoot(process.cwd());
  } catch {
    process.exit(0);
  }

  const functionsDir = getFunctionsDir(repoRoot);
  let recordFiles: string[] = [];
  try {
    const entries = await fs.readdir(functionsDir);
    recordFiles = entries.filter((e) => e.endsWith("_record.json"));
  } catch {
    process.exit(0);
  }

  if (recordFiles.length === 0) process.exit(0);

  const records: FunctionRecord[] = [];
  for (const filename of recordFiles) {
    try {
      const raw = await fs.readFile(path.join(functionsDir, filename), "utf-8");
      records.push(JSON.parse(raw) as FunctionRecord);
    } catch {
      // skip unreadable records
    }
  }

  if (records.length === 0) process.exit(0);

  // With the simplified audit system (no trust scores or risk ratings),
  // all pushes are allowed. Print a brief summary for visibility.
  const totalAudits = records.reduce((sum, r) => sum + r.auditHistory.length, 0);
  process.stderr.write(
    `git-audit: ${records.length} function(s) tracked, ${totalAudits} audit(s) recorded\n`
  );

  process.exit(0);
}

runPrePushHook().catch(() => {
  process.exit(0);
});
