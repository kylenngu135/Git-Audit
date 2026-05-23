import path from "path";
import fs from "fs/promises";
import type { PromptEvent, AuditCard, FunctionRecord } from "../shared/types.js";
import { loadPromptEvent } from "../shared/eventStore.js";
import { getFunctionsDir } from "../shared/utils.js";

export interface AuditContext {
  promptEvent: PromptEvent;
  commitHash: string;
  functionName: string;
  file: string;
  startLine: number;
  endLine: number;
  rawDiff: string;
  priorAuditHistory: AuditCard[];
  priorFunctionRecord: FunctionRecord | undefined;
  cobaseConventions: string[];
}

function safeFilename(file: string, functionName: string): string {
  return file.replace(/[/.]/g, "_") + `_${functionName}`;
}

export async function loadChangeset(eventId: string, repoRoot: string): Promise<any> {
  const filePath = path.join(repoRoot, ".audit", "events", `${eventId}-changeset.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    throw new Error(`Changeset not found for event ${eventId} (expected at ${filePath})`);
  }
}

export async function loadPriorAuditCards(
  functionName: string,
  file: string,
  repoRoot: string
): Promise<AuditCard[]> {
  const dir = getFunctionsDir(repoRoot);
  const prefix = safeFilename(file, functionName);

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const cards: AuditCard[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith(".json") || entry.endsWith("_record.json")) {
      continue;
    }
    try {
      const raw = await fs.readFile(path.join(dir, entry), "utf-8");
      cards.push(JSON.parse(raw) as AuditCard);
    } catch {
      // skip unreadable or malformed files
    }
  }

  return cards.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function loadPriorFunctionRecord(
  functionName: string,
  file: string,
  repoRoot: string
): Promise<FunctionRecord | undefined> {
  const dir = getFunctionsDir(repoRoot);
  const recordPath = path.join(dir, `${safeFilename(file, functionName)}_record.json`);
  try {
    const raw = await fs.readFile(recordPath, "utf-8");
    return JSON.parse(raw) as FunctionRecord;
  } catch {
    return undefined;
  }
}

export async function buildAuditContext(
  eventId: string,
  functionName: string,
  file: string,
  startLine: number,
  endLine: number,
  rawDiff: string,
  repoRoot: string
): Promise<AuditContext> {
  const [promptEvent, changeset, priorAuditHistory, priorFunctionRecord] = await Promise.all([
    loadPromptEvent(eventId, repoRoot),
    loadChangeset(eventId, repoRoot),
    loadPriorAuditCards(functionName, file, repoRoot),
    loadPriorFunctionRecord(functionName, file, repoRoot),
  ]);

  return {
    promptEvent,
    commitHash: changeset.commitHash as string,
    functionName,
    file,
    startLine,
    endLine,
    rawDiff,
    priorAuditHistory,
    priorFunctionRecord,
    cobaseConventions: [],
  };
}
