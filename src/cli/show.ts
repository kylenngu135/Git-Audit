import path from "path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { findRepoRoot, loadPromptEvent } from "../shared/eventStore.js";
import { loadFunctionRecord, loadAuditCard } from "../audit/cardStore.js";
import type { AuditCard, FunctionRecord } from "../shared/types.js";


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
  // ── Display helpers ──────────────────────────────────
  const BOX = 53;
  const IND = "  ";

  const boxLine = (text: string) => `│  ${text.padEnd(BOX - 2)}│`;

  const stat = (label: string, value: string) =>
    `${IND}${label.padEnd(14)}${value}`;

  const section = (title: string) => {
    console.log();
    console.log(`${IND}${title}`);
    console.log(`${IND}${"─".repeat(title.length)}`);
  };

  const trustBar = (score: number): string => {
    const filled = Math.round(score / 10);
    const bar = "█".repeat(filled) + "░".repeat(10 - filled);
    const code = score >= 80 ? "\x1b[32m" : score >= 50 ? "\x1b[33m" : "\x1b[31m";
    return `${code}${bar}\x1b[0m`;
  };

  // ── Not found ────────────────────────────────────────
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

  type ExtendedRisk = FunctionRecord["openRisks"][number] & { resolvedByPromptId?: string };
  type ExtendedRecord = Omit<FunctionRecord, "openRisks"> & { openRisks: ExtendedRisk[] };

  const raw = await fs.readFile(path.join(functionsDir, recordFilename), "utf-8");
  const record = JSON.parse(raw) as ExtendedRecord;

  const activeRisks = record.openRisks.filter((r) => !r.resolvedByPromptId);

  // ── Header ────────────────────────────────────────────
  console.log(`┌${"─".repeat(BOX)}┐`);
  console.log(boxLine(`git-audit — ${record.functionName}`));
  console.log(`└${"─".repeat(BOX)}┘`);
  console.log();
  console.log(stat("File", record.file));
  console.log(stat("Audits", String(record.auditHistory.length)));
  console.log(stat("Open risks", String(activeRisks.length)));
  console.log(stat("Trust score", `${record.trustScore}/100  ${trustBar(record.trustScore)}`));

  // ── Audit history (newest first) ──────────────────────
  const historyNewestFirst = [...record.auditHistory].reverse();

  for (let i = 0; i < historyNewestFirst.length; i++) {
    const entry = historyNewestFirst[i];
    let card: AuditCard | undefined;
    let promptPreview = entry.promptEventId;

    try {
      card = await loadAuditCard(entry.cardRef);
    } catch {
      // card file missing — show what we have
    }

    try {
      const event = await loadPromptEvent(entry.promptEventId, repoRoot);
      const rp = event.rawPrompt;
      promptPreview = rp.length > 80 ? rp.slice(0, 80) + "..." : rp;
    } catch {
      // event file missing — fall back to id
    }

    const dateStr = card ? new Date(card.createdAt).toLocaleDateString() : "unknown";

    console.log();
    console.log(`${IND}${"─".repeat(BOX)}`);
    console.log(`${IND}Audit ${i + 1} of ${historyNewestFirst.length} — ${dateStr}`);
    console.log(`${IND}Commit: ${entry.commitHash}`);
    console.log(`${IND}Prompt: "${promptPreview}"`);

    if (card) {
      section("What changed");
      console.log(`${IND}${card.what}`);

      section("Design decisions");
      card.decisions.forEach((decision, idx) => {
        console.log(`${IND}${idx + 1}. ${decision}`);
      });

      section("Risks");
      if (card.risks.length === 0) {
        console.log(`${IND}✓ No risks flagged`);
      } else {
        for (const risk of card.risks) {
          console.log(
            `${IND}${riskEmoji(risk.severity)} ${risk.severity.toUpperCase().padEnd(8)}${risk.message}`
          );
        }
      }

      section("Suggested tests");
      for (const test of card.testssuggested) {
        console.log(`${IND}□ ${test}`);
      }
    }
  }

  // ── Footer ────────────────────────────────────────────
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
