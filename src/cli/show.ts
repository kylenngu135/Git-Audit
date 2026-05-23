import path from "path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { findRepoRoot, loadPromptEvent } from "../shared/eventStore.js";
import { loadFunctionRecord, loadAuditCard } from "../audit/cardStore.js";
import type { AuditCard, FunctionRecord } from "../shared/types.js";

const SEP = "─────────────────────────────────────────";
const SEP_SHORT = "  ─────────────────────────────────";

function riskEmoji(severity: "low" | "medium" | "high"): string {
  if (severity === "high") return "🔴";
  if (severity === "medium") return "🟡";
  return "🟢";
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

  const recordFilename = await findRecordFile(functionsDir, functionName);
  if (!recordFilename) {
    console.log(`No audit record found for function: ${functionName}`);
    return;
  }

  type ExtendedRisk = FunctionRecord["openRisks"][number] & { resolvedByPromptId?: string };
  type ExtendedRecord = Omit<FunctionRecord, "openRisks"> & { openRisks: ExtendedRisk[] };

  const raw = await fs.readFile(path.join(functionsDir, recordFilename), "utf-8");
  const record = JSON.parse(raw) as ExtendedRecord;

  const activeRisks = record.openRisks.filter((r) => !r.resolvedByPromptId);

  console.log(SEP);
  console.log(`Function: ${record.functionName}`);
  console.log(`File:     ${record.file}`);
  console.log(SEP);
  console.log(`Audit history: ${record.auditHistory.length} audit(s)`);
  console.log(`Open risks:    ${activeRisks.length} risk(s)`);
  console.log(`Trust score:   ${record.trustScore}/100`);
  console.log(SEP);

  const historyNewestFirst = [...record.auditHistory].reverse();

  for (const entry of historyNewestFirst) {
    let card: AuditCard | undefined;
    let promptPreview = entry.promptEventId;

    try {
      card = await loadAuditCard(entry.cardRef);
    } catch {
      // card file missing — show what we have
    }

    try {
      const event = await loadPromptEvent(entry.promptEventId, repoRoot);
      promptPreview = event.rawPrompt.slice(0, 80);
    } catch {
      // event file missing — fall back to id
    }

    console.log();
    console.log(`  Prompt: "${promptPreview}"`);
    console.log(`  Commit: ${entry.commitHash}`);

    if (card) {
      const dateStr = new Date(card.createdAt).toLocaleDateString();
      console.log(`  Date:   ${dateStr}`);
      console.log();
      console.log("  What changed:");
      console.log(`  ${card.what}`);
      console.log();
      console.log("  Design decisions:");
      for (const decision of card.decisions) {
        console.log(`  • ${decision}`);
      }
      console.log();
      console.log("  Risks:");
      for (const risk of card.risks) {
        console.log(`  ${riskEmoji(risk.severity)} ${risk.message}`);
      }
      console.log();
      console.log("  Suggested tests:");
      for (const test of card.testssuggested) {
        console.log(`  □ ${test}`);
      }
    }

    console.log();
    console.log(SEP_SHORT);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const functionName = process.argv[2];
  if (!functionName) {
    console.error("Usage: node --import tsx/esm src/cli/show.ts <functionName>");
    process.exit(1);
  }
  runShow(functionName).catch((err: unknown) => {
    console.error("prompt-audit error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
