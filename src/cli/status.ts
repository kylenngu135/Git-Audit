import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "node:url";
import { findRepoRoot } from "../shared/eventStore.js";
import { getFunctionsDir, getEventsDir } from "../shared/utils.js";
import type { FunctionRecord, PromptEvent } from "../shared/types.js";

export async function runStatus(): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  const functionsDir = getFunctionsDir(repoRoot);
  const eventsDir = getEventsDir(repoRoot);

  let funcEntries: string[];
  try {
    funcEntries = await fs.readdir(functionsDir);
  } catch {
    funcEntries = [];
  }

  const recordFiles = funcEntries.filter((e) => e.endsWith("_record.json"));
  const records: FunctionRecord[] = [];
  for (const filename of recordFiles) {
    try {
      const raw = await fs.readFile(path.join(functionsDir, filename), "utf-8");
      records.push(JSON.parse(raw) as FunctionRecord);
    } catch {
      // skip unreadable records
    }
  }

  let eventEntries: string[];
  try {
    eventEntries = await fs.readdir(eventsDir);
  } catch {
    eventEntries = [];
  }

  const events: PromptEvent[] = [];
  for (const filename of eventEntries) {
    if (!filename.endsWith(".json") || filename.endsWith("-changeset.json")) continue;
    try {
      const raw = await fs.readFile(path.join(eventsDir, filename), "utf-8");
      events.push(JSON.parse(raw) as PromptEvent);
    } catch {
      // skip
    }
  }
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const BOX = 53;
  const INDENT = "  ";

  const section = (title: string) =>
    `\n${INDENT}${title}\n${INDENT}${"─".repeat(title.length)}`;

  console.log(`┌${"─".repeat(BOX)}┐`);
  console.log(`│  ${"git-audit — codebase overview".padEnd(BOX - 2)}│`);
  console.log(`└${"─".repeat(BOX)}┘`);
  console.log();

  console.log(`${INDENT}${"Functions tracked".padEnd(22)}${records.length}`);
  console.log(`${INDENT}${"Prompt events".padEnd(22)}${events.length}`);

  // Recent activity — last 5 audited events
  const recentEvents = events
    .filter((e) => e.status !== "pending")
    .slice(0, 5);

  if (recentEvents.length > 0) {
    console.log(section("Recent activity"));
    console.log();
    for (const event of recentEvents) {
      const date = new Date(event.timestamp).toLocaleDateString();
      const promptSnip = event.rawPrompt.slice(0, 60);
      const intentionSnip = (event.intention ?? "").slice(0, 60);
      console.log(`${INDENT}✅ ${date} — "${promptSnip}"`);
      if (intentionSnip) {
        console.log(`${INDENT}${"".padEnd(7)}Intent: "${intentionSnip}"`);
      }
    }
  }

  // All tracked functions
  if (records.length > 0) {
    console.log(section("All tracked functions"));
    console.log();
    for (const record of records) {
      const auditCount = record.auditHistory.length;
      console.log(
        `${INDENT}${record.functionName} — ${record.file} — ${auditCount} audit(s)`
      );
    }
  } else {
    console.log();
    console.log(
      `${INDENT}No audit records found. Have you committed any AI-generated code with git-audit running?`
    );
  }

  console.log();
  console.log(`${INDENT}${"─".repeat(BOX)}`);
  console.log(`${INDENT}Run 'audit show <function>' for full history.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runStatus().catch((err: unknown) => {
    console.error("git-audit error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
