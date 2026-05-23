import path from "path";
import fs from "fs/promises";
import type { AuditCard, FunctionRecord } from "../shared/types.js";
import { getFunctionsDir, getCurrentTimestamp, generateId } from "../shared/utils.js";

// openRisks entries may carry an optional resolvedByPromptId at runtime
type OpenRisk = FunctionRecord["openRisks"][number] & {
  resolvedByPromptId?: string;
};

const RESOLUTION_KEYWORDS = ["resolved", "fixed", "addressed", "added"];
const STOP_WORDS = new Set(["this", "that", "with", "from", "have", "been", "will", "when", "they", "them", "their", "there"]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

function isRiskMentionedAsResolved(risk: OpenRisk, decisions: string[]): boolean {
  const riskKeywords = extractKeywords(risk.message);
  return decisions.some((decision) => {
    const lower = decision.toLowerCase();
    const hasAction = RESOLUTION_KEYWORDS.some((kw) => lower.includes(kw));
    if (!hasAction) return false;
    return riskKeywords.some((kw) => lower.includes(kw));
  });
}

function computeTrustScore(openRisks: OpenRisk[]): number {
  const active = openRisks.filter((r) => !r.resolvedByPromptId);
  const high = active.filter((r) => r.severity === "high").length;
  const medium = active.filter((r) => r.severity === "medium").length;
  return Math.max(0, 100 - high * 25 - medium * 10);
}

export function buildSafeFilename(file: string, functionName: string): string {
  const sanitized = file.replace(/[/\\.]/g, "_");
  return `${sanitized}_${functionName}`;
}

export async function saveAuditCard(card: AuditCard, repoRoot: string): Promise<string> {
  const timestamp = card.createdAt.replace(/[:.]/g, "-");
  const filename = `${buildSafeFilename(card.file, card.functionName)}_${timestamp}_card.json`;
  const filePath = path.join(getFunctionsDir(repoRoot), filename);
  await fs.writeFile(filePath, JSON.stringify(card, null, 2));
  return filePath;
}

export async function loadAuditCard(filePath: string): Promise<AuditCard> {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as AuditCard;
}

export async function saveOrUpdateFunctionRecord(
  card: AuditCard,
  repoRoot: string
): Promise<void> {
  const dir = getFunctionsDir(repoRoot);
  const recordFilename = `${buildSafeFilename(card.file, card.functionName)}_record.json`;
  const recordPath = path.join(dir, recordFilename);

  // Reconstruct the card file path (same logic as saveAuditCard)
  const timestamp = card.createdAt.replace(/[:.]/g, "-");
  const cardFilename = `${buildSafeFilename(card.file, card.functionName)}_${timestamp}_card.json`;
  const cardRef = path.join(dir, cardFilename);

  const incomingRisks = card.risks.filter(
    (r) => r.severity === "medium" || r.severity === "high"
  );

  let record: FunctionRecord & { openRisks: OpenRisk[] };

  let exists = false;
  try {
    await fs.access(recordPath);
    exists = true;
  } catch {
    exists = false;
  }

  if (!exists) {
    const openRisks: OpenRisk[] = incomingRisks.map((r) => ({
      ...r,
      introducedByPromptId: card.promptEventId,
    }));

    record = {
      functionName: card.functionName,
      file: card.file,
      createdByPromptId: card.promptEventId,
      lastModifiedByPromptId: card.promptEventId,
      auditHistory: [
        {
          promptEventId: card.promptEventId,
          commitHash: card.commitHash,
          cardRef,
        },
      ],
      openRisks,
      trustScore: computeTrustScore(openRisks),
    };
  } else {
    const raw = await fs.readFile(recordPath, "utf-8");
    record = JSON.parse(raw) as FunctionRecord & { openRisks: OpenRisk[] };

    record.lastModifiedByPromptId = card.promptEventId;

    record.auditHistory.push({
      promptEventId: card.promptEventId,
      commitHash: card.commitHash,
      cardRef,
    });

    // Mark existing open risks as resolved if a decision mentions them
    for (const risk of record.openRisks) {
      if (!risk.resolvedByPromptId && isRiskMentionedAsResolved(risk, card.decisions)) {
        risk.resolvedByPromptId = card.promptEventId;
      }
    }

    // Add new medium/high risks not already present
    const existingMessages = new Set(record.openRisks.map((r) => r.message));
    for (const r of incomingRisks) {
      if (!existingMessages.has(r.message)) {
        record.openRisks.push({
          ...r,
          introducedByPromptId: card.promptEventId,
        });
      }
    }

    record.trustScore = computeTrustScore(record.openRisks);
  }

  await fs.writeFile(recordPath, JSON.stringify(record, null, 2));
}

export async function loadFunctionRecord(
  functionName: string,
  file: string,
  repoRoot: string
): Promise<FunctionRecord | undefined> {
  const recordPath = path.join(
    getFunctionsDir(repoRoot),
    `${buildSafeFilename(file, functionName)}_record.json`
  );
  try {
    const raw = await fs.readFile(recordPath, "utf-8");
    return JSON.parse(raw) as FunctionRecord;
  } catch {
    return undefined;
  }
}
