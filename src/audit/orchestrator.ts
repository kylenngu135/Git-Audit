// NOTE: This module is no longer used in the automatic
// audit pipeline. Cards are now generated directly from
// the developer's intention and Claude's captured
// response in the post-commit hook.
// Kept as a manual fallback for deep analysis.

import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "node:url";
import {
  findRepoRoot,
  listPendingEvents,
  loadPromptEvent,
  updatePromptEvent,
} from "../shared/eventStore.js";
import { loadChangeset, buildAuditContext, initAuditCache } from "./contextBuilder.js";
import { generateAuditCard } from "./cardGenerator.js";
import { saveAuditCard, saveOrUpdateFunctionRecord } from "./cardStore.js";

type ChangesetFunction = {
  functionName: string;
  file: string;
  startLine: number;
  endLine: number;
  hunkCount: number;
  rawContent?: string;
};

async function findMostRecentLinkedEvent(
  repoRoot: string
): Promise<string | undefined> {
  const eventsDir = path.join(repoRoot, ".audit", "events");
  let entries: string[];
  try {
    entries = await fs.readdir(eventsDir);
  } catch {
    return undefined;
  }

  const linked: Array<{ id: string; timestamp: string }> = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry.endsWith("-changeset.json")) continue;
    try {
      const raw = await fs.readFile(path.join(eventsDir, entry), "utf-8");
      const event = JSON.parse(raw) as { id: string; status: string; timestamp: string };
      if (event.status === "linked") {
        linked.push({ id: event.id, timestamp: event.timestamp });
      }
    } catch {
      // skip unreadable or malformed files
    }
  }

  if (linked.length === 0) return undefined;
  linked.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return linked[0].id;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
  );
  return Promise.race([promise, timeout]);
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrent: number
): Promise<(T | null)[]> {
  const results: (T | null)[] = new Array(tasks.length).fill(null);
  const executing: Promise<void>[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = async () => {
      try {
        results[i] = await tasks[i]();
      } catch (err: any) {
        console.error(`git-audit: task ${i} failed: ${err.message}`);
        results[i] = null;
      }
    };

    const p = task().then(() => {
      executing.splice(executing.indexOf(p), 1);
    });
    executing.push(p);

    if (executing.length >= maxConcurrent) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

export async function runAuditOrchestrator(
  eventId?: string,
  repoRoot?: string
): Promise<void> {
  // Resolve repo root
  const root = repoRoot ?? (await findRepoRoot(process.cwd()));

  // Resolve event ID
  let targetEventId = eventId;
  if (!targetEventId) {
    targetEventId = await findMostRecentLinkedEvent(root);
    if (!targetEventId) {
      process.stderr.write(
        "git-audit: no linked prompt events found to audit. Run after committing AI-generated code.\n"
      );
      return;
    }
  }

  // Load changeset
  const changeset = await loadChangeset(targetEventId, root) as {
    promptEventId: string;
    commitHash: string;
    functionsChanged?: ChangesetFunction[];
  };

  if (!changeset.functionsChanged || changeset.functionsChanged.length === 0) {
    process.stderr.write("git-audit: no functions to audit in this changeset\n");
    return;
  }

  // Load prompt event for log message
  const promptEvent = await loadPromptEvent(targetEventId, root);
  const preview = promptEvent.rawPrompt.slice(0, 60);

  process.stderr.write(
    `git-audit: starting audit for ${changeset.functionsChanged.length} function(s) from prompt: ${preview}...\n`
  );

  const cacheStart = Date.now();
  await initAuditCache(root);
  console.error(`git-audit: cache init took ${Date.now() - cacheStart}ms`);
  process.stderr.write("git-audit: convention cache initialized\n");

  // Capped at 3 to avoid overwhelming the Claude Code CLI
  // with too many simultaneous processes. Increase if your
  // machine handles it well, decrease if you see timeouts.
  const CONCURRENCY_LIMIT = parseInt(process.env.GIT_AUDIT_CONCURRENCY || "3");

  process.stderr.write(
    `git-audit: auditing ${changeset.functionsChanged.length} function(s) with concurrency limit of ${CONCURRENCY_LIMIT}...\n`
  );

  const auditTasks = changeset.functionsChanged.map((fn) => async () => {
    process.stderr.write(`git-audit: auditing ${fn.functionName} in ${fn.file}...\n`);

    const rawDiff = fn.rawContent ?? "";

    const context = await buildAuditContext(
      targetEventId,
      fn.functionName,
      fn.file,
      fn.startLine,
      fn.endLine,
      rawDiff,
      root
    );

    const card = await withTimeout(
      generateAuditCard(context, root),
      45000,
      fn.functionName
    );

    await saveAuditCard(card, root);
    await saveOrUpdateFunctionRecord(card, root);

    process.stderr.write(
      `git-audit: ✓ ${fn.functionName} — card saved\n`
    );

    return fn.functionName;
  });

  const startTime = Date.now();
  const results = await runWithConcurrency(auditTasks, CONCURRENCY_LIMIT);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const succeeded = results.filter((r) => r !== null).length;
  const failed = results.filter((r) => r === null).length;

  // Mark event as audited — must stay after parallel tasks complete
  await updatePromptEvent(targetEventId, { status: "audited" }, root);

  process.stderr.write(
    `git-audit: audit complete in ${elapsed}s — ${succeeded} succeeded, ${failed} failed\n`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const eventId = process.argv[2];
  runAuditOrchestrator(eventId).catch((err) => {
    console.error("git-audit error:", (err as Error).message);
    process.exit(1);
  });
}
