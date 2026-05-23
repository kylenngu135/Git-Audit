import path from "path";
import fs from "fs/promises";
import type { PromptEvent, AuditCard, FunctionRecord } from "../shared/types.js";
import { loadPromptEvent } from "../shared/eventStore.js";
import { getFunctionsDir } from "../shared/utils.js";

export interface CodebaseSummary {
  totalFunctions: number;
  functionsWithHighRisks: number;
  recentFunctions: Array<{
    functionName: string;
    file: string;
    latestDecision: string;
  }>;
}

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
  codebaseSummary: CodebaseSummary | undefined;
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

async function readRecord(recordPath: string): Promise<FunctionRecord | undefined> {
  try {
    const raw = await fs.readFile(recordPath, "utf-8");
    return JSON.parse(raw) as FunctionRecord;
  } catch {
    return undefined;
  }
}

async function readCard(cardPath: string): Promise<AuditCard | undefined> {
  try {
    const raw = await fs.readFile(cardPath, "utf-8");
    return JSON.parse(raw) as AuditCard;
  } catch {
    return undefined;
  }
}

async function listRecordPaths(repoRoot: string): Promise<string[]> {
  const dir = getFunctionsDir(repoRoot);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  return entries.filter((e) => e.endsWith("_record.json")).map((e) => path.join(dir, e));
}

function matchesAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

function countCardsWithMatch(cards: AuditCard[], needles: string[]): number {
  let count = 0;
  for (const card of cards) {
    const joined = card.decisions.join(" ");
    if (matchesAny(joined, needles)) count += 1;
  }
  return count;
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "and", "or", "in", "on", "for", "with", "is", "are",
  "this", "that", "these", "those", "be", "been", "being", "by", "as", "at", "it",
  "its", "if", "may", "might", "will", "would", "should", "could", "can", "but",
  "not", "no", "do", "does", "did", "has", "have", "had", "from", "any", "all",
  "than", "then", "when", "which", "what", "who", "why", "how", "function", "value",
  "values", "input", "inputs", "output", "outputs", "case", "cases", "code", "result",
  "results", "data", "type", "types",
]);

function keywordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

function findRecurringRiskThemes(highRiskMessages: string[]): string[] {
  const counts = new Map<string, { count: number; examples: string[] }>();
  for (const msg of highRiskMessages) {
    const words = new Set(keywordsOf(msg));
    for (const w of words) {
      const entry = counts.get(w) ?? { count: 0, examples: [] };
      entry.count += 1;
      if (entry.examples.length < 1) entry.examples.push(msg);
      counts.set(w, entry);
    }
  }
  const recurring: string[] = [];
  const seen = new Set<string>();
  const sorted = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [word, entry] of sorted) {
    if (entry.count < 2) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    recurring.push(word);
    if (recurring.length >= 3) break;
  }
  return recurring;
}

export async function extractConventions(
  repoRoot: string,
  currentFile: string,
  currentFunctionName: string
): Promise<string[]> {
  const recordPaths = await listRecordPaths(repoRoot);
  const cards: AuditCard[] = [];
  const highRiskMessages: string[] = [];

  for (const recordPath of recordPaths) {
    const record = await readRecord(recordPath);
    if (!record) continue;
    if (record.functionName === currentFunctionName && record.file === currentFile) continue;
    if (record.auditHistory.length === 0) continue;

    const latest = record.auditHistory[record.auditHistory.length - 1];
    const card = await readCard(latest.cardRef);
    if (card) cards.push(card);

    for (const risk of record.openRisks ?? []) {
      if (risk.severity === "high") highRiskMessages.push(risk.message);
    }
  }

  const conventions: string[] = [];

  if (countCardsWithMatch(cards, ["throw", "TypeError", "Error("]) >= 3) {
    conventions.push(
      "This codebase throws typed errors for invalid inputs rather than returning null or undefined"
    );
  }
  if (countCardsWithMatch(cards, ["try/catch", "try {", "catch ("]) >= 3) {
    conventions.push("This codebase uses try/catch blocks for error handling");
  }
  if (countCardsWithMatch(cards, ["return null", "return undefined"]) >= 3) {
    conventions.push(
      "This codebase returns null/undefined instead of throwing for invalid states"
    );
  }
  if (countCardsWithMatch(cards, ["async/await", "async function", "await "]) >= 3) {
    conventions.push("This codebase consistently uses async/await over raw Promises");
  }
  if (countCardsWithMatch(cards, ["Promise.then", ".then("]) >= 3) {
    conventions.push("This codebase uses Promise chains over async/await");
  }
  if (countCardsWithMatch(cards, ["validate", "validation"]) >= 3) {
    conventions.push(
      "This codebase validates inputs at the function entry point before any logic runs"
    );
  }
  if (countCardsWithMatch(cards, ["single responsibility"]) >= 3) {
    conventions.push(
      "This codebase follows single responsibility — functions do one thing only"
    );
  }
  if (countCardsWithMatch(cards, ["pure function", "no side effects"]) >= 3) {
    conventions.push(
      "This codebase prefers pure functions without side effects where possible"
    );
  }

  const themes = findRecurringRiskThemes(highRiskMessages);
  for (const theme of themes) {
    conventions.push(
      `Known recurring risk in this codebase: ${theme} — pay extra attention to this`
    );
  }

  const unique = Array.from(new Set(conventions));
  return unique.slice(0, 8);
}

export async function getCodebaseSummary(repoRoot: string): Promise<CodebaseSummary | undefined> {
  const dir = getFunctionsDir(repoRoot);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return undefined;
  }

  const recordEntries = entries.filter((e) => e.endsWith("_record.json"));
  if (recordEntries.length === 0) return undefined;

  const withStats = await Promise.all(
    recordEntries.map(async (name) => {
      const full = path.join(dir, name);
      try {
        const stat = await fs.stat(full);
        return { full, mtimeMs: stat.mtimeMs };
      } catch {
        return undefined;
      }
    })
  );
  const sorted = withStats.filter((x): x is { full: string; mtimeMs: number } => x !== undefined)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  let totalFunctions = 0;
  let functionsWithHighRisks = 0;
  const recentFunctions: CodebaseSummary["recentFunctions"] = [];

  for (const { full } of sorted) {
    const record = await readRecord(full);
    if (!record) continue;
    totalFunctions += 1;
    if ((record.openRisks ?? []).some((r) => r.severity === "high")) {
      functionsWithHighRisks += 1;
    }
    if (recentFunctions.length < 5 && record.auditHistory.length > 0) {
      const latest = record.auditHistory[record.auditHistory.length - 1];
      const card = await readCard(latest.cardRef);
      const decision = card && card.decisions.length > 0 ? card.decisions[0] : "";
      if (decision) {
        recentFunctions.push({
          functionName: record.functionName,
          file: record.file,
          latestDecision: decision,
        });
      }
    }
  }

  if (totalFunctions === 0) return undefined;
  return { totalFunctions, functionsWithHighRisks, recentFunctions };
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
  const [
    promptEvent,
    changeset,
    priorAuditHistory,
    priorFunctionRecord,
    cobaseConventions,
    codebaseSummary,
  ] = await Promise.all([
    loadPromptEvent(eventId, repoRoot),
    loadChangeset(eventId, repoRoot),
    loadPriorAuditCards(functionName, file, repoRoot),
    loadPriorFunctionRecord(functionName, file, repoRoot),
    extractConventions(repoRoot, file, functionName),
    getCodebaseSummary(repoRoot),
  ]);

  const filteredSummary: CodebaseSummary | undefined = codebaseSummary
    ? {
        ...codebaseSummary,
        recentFunctions: codebaseSummary.recentFunctions.filter(
          (rf) => !(rf.functionName === functionName && rf.file === file)
        ),
      }
    : undefined;

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
    cobaseConventions,
    codebaseSummary: filteredSummary,
  };
}
