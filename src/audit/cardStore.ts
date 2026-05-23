import path from "path";
import fs from "fs/promises";
import type { AuditCard, FunctionRecord } from "../shared/types.js";
import { getFunctionsDir } from "../shared/utils.js";

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

  const timestamp = card.createdAt.replace(/[:.]/g, "-");
  const cardFilename = `${buildSafeFilename(card.file, card.functionName)}_${timestamp}_card.json`;
  const cardRef = path.join(dir, cardFilename);

  let record: FunctionRecord;

  let exists = false;
  try {
    await fs.access(recordPath);
    exists = true;
  } catch {
    exists = false;
  }

  if (!exists) {
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
    };
  } else {
    const raw = await fs.readFile(recordPath, "utf-8");
    record = JSON.parse(raw) as FunctionRecord;
    record.lastModifiedByPromptId = card.promptEventId;
    record.auditHistory.push({
      promptEventId: card.promptEventId,
      commitHash: card.commitHash,
      cardRef,
    });
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
