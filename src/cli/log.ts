import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { findRepoRoot } from "../shared/eventStore.js";
import { getEventsDir } from "../shared/utils.js";
import type { PromptEvent } from "../shared/types.js";

const SEP = "─────────────────────────────────────────";

function statusEmoji(status: PromptEvent["status"]): string {
  if (status === "pending") return "⏳";
  if (status === "linked") return "🔗";
  return "✅";
}

export async function runLog(): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  const eventsDir = getEventsDir(repoRoot);

  let entries: string[];
  try {
    entries = await fs.readdir(eventsDir);
  } catch {
    entries = [];
  }

  const eventFiles = entries.filter(
    (e) => e.endsWith(".json") && !e.endsWith("-changeset.json")
  );

  const events: PromptEvent[] = [];
  for (const filename of eventFiles) {
    const raw = await fs.readFile(path.join(eventsDir, filename), "utf-8");
    events.push(JSON.parse(raw) as PromptEvent);
  }

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (events.length === 0) {
    process.stdout.write(
      "No prompt events found. Start the MCP server and use Claude Code to capture your first prompt.\n"
    );
    return;
  }

  process.stdout.write(`${SEP}\naudit log — ${events.length} prompt event(s)\n${SEP}\n`);

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const preview = event.rawPrompt.slice(0, 70);
    const dateStr = new Date(event.timestamp).toLocaleString();

    process.stdout.write(
      [
        `\n  [${i + 1}] ${statusEmoji(event.status)} ${preview}`,
        `  ID:      ${event.id}`,
        `  Tool:    ${event.aiTool}`,
        `  Date:    ${dateStr}`,
        `  Commit:  ${event.linkedCommit ?? "not yet linked"}`,
        `  Status:  ${event.status}`,
      ].join("\n") + "\n"
    );

    const changesetPath = path.join(eventsDir, `${event.id}-changeset.json`);
    try {
      const raw = await fs.readFile(changesetPath, "utf-8");
      const changeset = JSON.parse(raw) as {
        functionsChanged: Array<{ functionName: string }>;
      };
      if (changeset.functionsChanged?.length > 0) {
        const names = changeset.functionsChanged.map((f) => f.functionName).join(", ");
        process.stdout.write(`  Functions changed: ${names}\n`);
      }
    } catch {
      // no changeset for this event
    }

    process.stdout.write(`\n${SEP}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runLog().catch((err: unknown) => {
    process.stderr.write(`audit error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
