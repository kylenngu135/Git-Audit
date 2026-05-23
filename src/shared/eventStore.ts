import fs from "node:fs/promises";
import path from "node:path";
import type { PromptEvent } from "./types.js";
import { getEventsDir } from "./utils.js";

export async function findRepoRoot(startPath: string): Promise<string> {
  let current = startPath;
  while (true) {
    try {
      await fs.access(path.join(current, ".git"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error("Not inside a git repository");
      }
      current = parent;
    }
  }
}

export async function savePromptEvent(event: PromptEvent): Promise<string> {
  const repoRoot = await findRepoRoot(process.cwd());
  const filePath = path.join(getEventsDir(repoRoot), `${event.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(event, null, 2));
  return filePath;
}

export async function loadPromptEvent(eventId: string, repoRoot: string): Promise<PromptEvent> {
  const filePath = path.join(getEventsDir(repoRoot), `${eventId}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as PromptEvent;
  } catch {
    throw new Error(`Prompt event not found: ${eventId} (expected at ${filePath})`);
  }
}

export async function listPendingEvents(repoRoot: string): Promise<PromptEvent[]> {
  const dir = getEventsDir(repoRoot);
  const entries = await fs.readdir(dir);
  const events: PromptEvent[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const raw = await fs.readFile(path.join(dir, entry), "utf-8");
    const event = JSON.parse(raw) as PromptEvent;
    if (event.status === "pending") {
      events.push(event);
    }
  }
  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function updatePromptEvent(
  eventId: string,
  updates: Partial<PromptEvent>,
  repoRoot: string
): Promise<void> {
  const existing = await loadPromptEvent(eventId, repoRoot);
  const updated = { ...existing, ...updates };
  const filePath = path.join(getEventsDir(repoRoot), `${eventId}.json`);
  await fs.writeFile(filePath, JSON.stringify(updated, null, 2));
}
