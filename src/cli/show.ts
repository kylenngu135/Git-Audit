import path from "path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { findRepoRoot } from "../shared/eventStore.js";
import { loadAuditCard } from "../audit/cardStore.js";
import type { AuditCard, FunctionRecord } from "../shared/types.js";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function maybeDisplay(text: string): string {
  const fallbacks = [
    "No intention captured.",
    "No prompt captured.",
    "No response summary captured.",
    "Captured before intention tracking was added.",
    "Captured before response tracking was added.",
  ];
  if (fallbacks.includes(text)) return `${DIM}${text}${RESET}`;
  return text;
}

async function findRecordFile(
  functionsDir: string,
  input: string
): Promise<string | undefined> {
  let entries: string[];
  try {
    entries = await fs.readdir(functionsDir);
  } catch {
    return undefined;
  }
  const recordFiles = entries.filter((e) => e.endsWith("_record.json"));

  if (input.includes(":")) {
    const colonIdx = input.indexOf(":");
    const filePattern = input.slice(0, colonIdx);
    const fnName = input.slice(colonIdx + 1);
    return recordFiles.find(
      (e) => e.includes(filePattern) && e.endsWith(`_${fnName}_record.json`)
    );
  }
  return recordFiles.find((e) => e.endsWith(`_${input}_record.json`));
}

export async function runShow(functionName: string): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  const functionsDir = path.join(repoRoot, ".audit", "functions");

  const BOX = 53;
  const IND = "  ";

  const boxLine = (text: string) => `│  ${text.padEnd(BOX - 2)}│`;
  const stat = (label: string, value: string) => `${IND}${label.padEnd(14)}${value}`;

  const recordFilename = await findRecordFile(functionsDir, functionName);

  if (!recordFilename) {
    console.log(`┌${"─".repeat(BOX)}┐`);
    console.log(boxLine("git-audit — function not found"));
    console.log(`└${"─".repeat(BOX)}┘`);
    console.log();
    console.log(`${IND}No audit record found for: ${functionName}`);
    console.log();
    console.log(`${IND}Has this function been committed with Claude Code running?`);
    console.log(`${IND}Run 'audit log' to see all captured prompts.`);
    return;
  }

  const raw = await fs.readFile(path.join(functionsDir, recordFilename), "utf-8");
  const record = JSON.parse(raw) as FunctionRecord;

  console.log(`┌${"─".repeat(BOX)}┐`);
  console.log(boxLine(`git-audit — ${record.functionName}`));
  console.log(`└${"─".repeat(BOX)}┘`);
  console.log();
  console.log(stat("File", record.file));
  console.log(stat("Audits", String(record.auditHistory.length)));

  const historyNewestFirst = [...record.auditHistory].reverse();

  for (const entry of historyNewestFirst) {
    let card: AuditCard | undefined;
    try {
      card = await loadAuditCard(entry.cardRef);
    } catch {
      // card file missing — show what we have from the record entry
    }

    const dateStr = card ? new Date(card.createdAt).toLocaleDateString() : "unknown";
    const hash = entry.commitHash.slice(0, 7);

    console.log();
    console.log(`${IND}${"─".repeat(BOX)}`);
    console.log(`${IND}${dateStr} — commit ${hash}`);

    if (card) {
      const intention = card.intention ?? "No intention captured.";
      const prompt = card.prompt ?? "No prompt captured.";
      const responseSummary = card.responseSummary ?? "No response summary captured.";

      console.log();
      console.log(`${IND}Intention`);
      console.log(`${IND}─────────`);
      console.log(`${IND}${maybeDisplay(intention)}`);

      console.log();
      console.log(`${IND}Prompt`);
      console.log(`${IND}──────`);
      console.log(`${IND}${maybeDisplay(prompt)}`);

      console.log();
      console.log(`${IND}Claude's response`);
      console.log(`${IND}─────────────────`);
      console.log(`${IND}${maybeDisplay(responseSummary)}`);
    } else {
      console.log(`${IND}${DIM}Card data not available.${RESET}`);
    }
  }

  console.log();
  console.log(`${IND}${"─".repeat(BOX)}`);
  console.log(`${IND}Run 'audit status' for codebase overview.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const functionName = process.argv[2];
  if (!functionName) {
    console.error("Usage: node --import tsx/esm src/cli/show.ts <functionName>");
    process.exit(1);
  }
  runShow(functionName).catch((err: unknown) => {
    console.error("git-audit error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
