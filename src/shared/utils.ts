import path from "node:path";

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

export function getAuditDir(repoRoot: string): string {
  return path.join(repoRoot, ".audit");
}

export function getEventsDir(repoRoot: string): string {
  return path.join(repoRoot, ".audit", "events");
}

export function getFunctionsDir(repoRoot: string): string {
  return path.join(repoRoot, ".audit", "functions");
}
