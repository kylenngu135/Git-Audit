// NOTE: This module is no longer used in the automatic
// audit pipeline. Cards are now generated directly from
// the developer's intention and Claude's captured
// response in the post-commit hook.
// Kept as a manual fallback for deep analysis.

import path from "path";
import { tmpdir } from "os";
import { writeFile, unlink } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import type { AuditContext } from "./contextBuilder.js";
import type { AuditCard } from "../shared/types.js";
import { generateId, getCurrentTimestamp } from "../shared/utils.js";

const execAsync = promisify(exec);

const SYSTEM_MESSAGE =
  "You are a precise code auditor. You analyze code changes made by AI coding assistants and return structured audit data as raw JSON. You never add explanation or markdown.";

export function buildAuditPrompt(context: AuditContext): string {
  const lines: string[] = [];

  lines.push("ORIGINAL PROMPT (what the developer asked the AI to do):");
  lines.push(context.promptEvent.rawPrompt);
  lines.push("");
  lines.push(`FUNCTION NAME: ${context.functionName}`);
  lines.push(`FILE: ${context.file}`);
  lines.push(`LINES: ${context.startLine} to ${context.endLine}`);
  lines.push("");
  lines.push("CODE CHANGES (unified diff for this function only):");
  lines.push(context.rawDiff);

  if (context.priorAuditHistory.length > 0) {
    const lastThree = context.priorAuditHistory.slice(-3);
    lines.push("");
    lines.push(
      "PRIOR AUDIT HISTORY FOR THIS FUNCTION (use this to detect resolved risks and track evolution):"
    );
    lines.push(JSON.stringify(lastThree, null, 2));
  }

  if (context.cobaseConventions.length > 0) {
    lines.push("");
    lines.push("KNOWN CODEBASE CONVENTIONS (flag any violations in your audit):");
    for (const convention of context.cobaseConventions) {
      lines.push(`- ${convention}`);
    }
  }

  if (context.codebaseSummary && context.codebaseSummary.totalFunctions > 0) {
    const summary = context.codebaseSummary;
    lines.push("");
    lines.push("FULL CODEBASE AUDIT SUMMARY:");
    lines.push(`Total functions audited in this codebase: ${summary.totalFunctions}`);
    lines.push(`Functions with open high risks: ${summary.functionsWithHighRisks}`);
    if (summary.recentFunctions.length > 0) {
      lines.push("Most recently audited functions and their key decisions:");
      for (const rf of summary.recentFunctions) {
        lines.push(`- ${rf.functionName} (${rf.file}): ${rf.latestDecision}`);
      }
    }
  }

  lines.push("");
  lines.push(
    'Respond with ONLY a valid JSON object matching the schema described. No markdown, no explanation, no code fences. Raw JSON only.'
  );
  lines.push("");
  lines.push("The JSON object must have exactly these fields:");
  lines.push(
    '  "what": string — plain English explanation of what this function now does after the change, 2-4 sentences max'
  );
  lines.push(
    '  "decisions": string array — each item describes one design decision the AI made. Format: "Chose X over Y because Z". Minimum 1, maximum 5 items.'
  );
  lines.push(
    '  "risks": array of objects, each with "message" (string) and "severity" (exactly one of "low", "medium", or "high")'
  );
  lines.push(
    '  "testssuggested": string array — each item is a specific test case in plain English. Format: "Given X when Y then Z". Minimum 2, maximum 5 items.'
  );
  lines.push('  "trustStatus": exactly the string "unverified"');

  return lines.join("\n");
}

const REQUIRED_FIELDS = ["what"] as const;

function stripMarkdownFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function validateParsed(parsed: Record<string, unknown>): void {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in parsed)) {
      throw new Error(`Audit response missing required field: "${field}"`);
    }
  }
}

function buildAuditCard(context: AuditContext, parsed: Record<string, unknown>): AuditCard {
  return {
    id: generateId(),
    promptEventId: context.promptEvent.id,
    commitHash: context.commitHash,
    file: context.file,
    functionName: context.functionName,
    prompt: context.promptEvent.rawPrompt.slice(0, 300),
    intention: context.promptEvent.intention?.slice(0, 300) ?? "No intention captured.",
    responseSummary: (parsed.what as string | undefined)?.slice(0, 500) ?? "No response summary captured.",
    createdAt: getCurrentTimestamp(),
  };
}

async function isClaudeCliAvailable(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("which claude");
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function generateViaClaudeCli(prompt: string): Promise<Record<string, unknown>> {
  const tmpFile = path.join(tmpdir(), `git-audit-${generateId()}.txt`);
  await writeFile(tmpFile, prompt, "utf-8");

  let stdout: string;
  let stderr: string;
  try {
    const result = await execAsync(`claude -p "$(cat ${tmpFile})" < /dev/null`, {
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } finally {
    await unlink(tmpFile).catch(() => {});
  }

  if (stderr && stderr.trim().length > 0) {
    process.stderr.write(`git-audit: claude CLI stderr: ${stderr}\n`);
  }

  if (!stdout || stdout.trim().length === 0) {
    throw new Error(
      "Claude Code CLI returned empty response. Is Claude Code installed and authenticated?"
    );
  }

  const cleaned = stripMarkdownFences(stdout);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    process.stderr.write(`git-audit: raw Claude Code CLI stdout was:\n${stdout}\n`);
    throw new Error("Failed to parse Claude Code CLI response as JSON");
  }

  validateParsed(parsed);
  return parsed;
}

async function generateViaAnthropicApi(prompt: string): Promise<Record<string, unknown>> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYSTEM_MESSAGE,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude response contained no text block");
  }

  const cleaned = stripMarkdownFences(textBlock.text);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error(`Claude returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  validateParsed(parsed);
  return parsed;
}

export async function generateAuditCard(
  context: AuditContext,
  _repoRoot: string
): Promise<AuditCard> {
  const prompt = buildAuditPrompt(context);
  const cliAvailable = await isClaudeCliAvailable();
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (cliAvailable) {
    process.stderr.write("git-audit: generating audit card via Claude Code CLI\n");
    try {
      const parsed = await generateViaClaudeCli(prompt);
      return buildAuditCard(context, parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (apiKey) {
        process.stderr.write(
          `git-audit: Claude Code CLI failed (${message}), falling back to API\n`
        );
        const parsed = await generateViaAnthropicApi(prompt);
        return buildAuditCard(context, parsed);
      }
      throw new Error(
        `git-audit: audit card generation failed. Claude Code CLI is not available and ANTHROPIC_API_KEY is not set. Install Claude Code or set ANTHROPIC_API_KEY. Underlying error: ${message}`
      );
    }
  }

  if (apiKey) {
    process.stderr.write("git-audit: generating audit card via Anthropic API\n");
    const parsed = await generateViaAnthropicApi(prompt);
    return buildAuditCard(context, parsed);
  }

  throw new Error(
    "git-audit: audit card generation failed. Claude Code CLI is not available and ANTHROPIC_API_KEY is not set. Install Claude Code or set ANTHROPIC_API_KEY."
  );
}
