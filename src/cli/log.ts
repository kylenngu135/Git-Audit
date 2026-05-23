import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { findRepoRoot } from "../shared/eventStore.js";
import { getEventsDir } from "../shared/utils.js";
import type { PromptEvent } from "../shared/types.js";


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

  // ── Display helpers ──────────────────────────────────
  const BOX = 53;
  const IND = "  ";
  const PIPE = "┆";

  const boxLine = (text: string) => `│  ${text.padEnd(BOX - 2)}│`;

  const meta = (label: string, value: string) =>
    `${IND}${PIPE}  ${label.padEnd(10)}${value}`;

  const wrapPrompt = (text: string): string => {
    const WIDTH = 70;
    const cont = `${IND}${PIPE}  `;
    if (text.length <= WIDTH) return text;
    const lines: string[] = [];
    let rem = text;
    while (rem.length > WIDTH) {
      let cut = rem.lastIndexOf(" ", WIDTH);
      if (cut <= 0) cut = WIDTH;
      lines.push(rem.slice(0, cut).trimEnd());
      rem = rem.slice(cut).trimStart();
    }
    if (rem) lines.push(rem);
    return lines.join(`\n${cont}`);
  };

  // ── Empty state ───────────────────────────────────────
  if (events.length === 0) {
    console.log(`┌${"─".repeat(BOX)}┐`);
    console.log(boxLine("git-audit — no prompt history yet"));
    console.log(`└${"─".repeat(BOX)}┘`);
    console.log();
    console.log(`${IND}Start by using Claude Code with the MCP server running.`);
    console.log(`${IND}Every prompt you send will appear here after committing.`);
    return;
  }

  // ── Header ────────────────────────────────────────────
  console.log(`┌${"─".repeat(BOX)}┐`);
  console.log(boxLine(`git-audit — prompt history (${events.length} events)`));
  console.log(`└${"─".repeat(BOX)}┘`);
  console.log();

  // ── Events ────────────────────────────────────────────
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const dt = new Date(event.timestamp);
    const datePart = dt.toLocaleDateString();
    const timePart = dt.toLocaleTimeString();
    const commit = event.linkedCommit ?? "pending";

    console.log(`${IND}${statusEmoji(event.status)} [${i + 1}/${events.length}] ${datePart} ${timePart}`);
    console.log(`${IND}${PIPE}`);
    console.log(`${IND}${PIPE}  ${wrapPrompt(event.rawPrompt)}`);
    console.log(`${IND}${PIPE}`);
    console.log(meta("ID", event.id));
    console.log(meta("Commit", commit));
    console.log(meta("Tool", event.aiTool ?? "unknown"));
    console.log(meta("Status", event.status));
    console.log(`${IND}${PIPE}`);

    const changesetPath = path.join(eventsDir, `${event.id}-changeset.json`);
    try {
      const raw = await fs.readFile(changesetPath, "utf-8");
      const changeset = JSON.parse(raw) as {
        functionsChanged: Array<{ functionName: string }>;
      };
      if (changeset.functionsChanged?.length > 0) {
        const names = changeset.functionsChanged.map((f) => f.functionName).join(", ");
        console.log(`${IND}${PIPE}  Functions changed: ${names}`);
        console.log(`${IND}${PIPE}`);
      }
    } catch {
      // no changeset for this event
    }

    console.log(`${IND}│`);
    console.log(`${IND}▼`);
    if (i < events.length - 1) console.log();
  }

  // ── Footer ────────────────────────────────────────────
  console.log();
  console.log(`${IND}${"─".repeat(BOX)}`);
  console.log(`${IND}Run 'audit show <function>' to inspect any function.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runLog().catch((err: unknown) => {
    process.stderr.write(`audit error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
