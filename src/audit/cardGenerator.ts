import Anthropic from "@anthropic-ai/sdk";
import type { AuditContext } from "./contextBuilder.js";
import type { AuditCard } from "../shared/types.js";
import { generateId, getCurrentTimestamp } from "../shared/utils.js";

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
    lines.push("KNOWN CODEBASE CONVENTIONS (flag violations):");
    for (const convention of context.cobaseConventions) {
      lines.push(convention);
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

const REQUIRED_FIELDS = ["what", "decisions", "risks", "testssuggested", "trustStatus"] as const;

export async function generateAuditCard(
  context: AuditContext,
  _repoRoot: string
): Promise<AuditCard> {
  const client = new Anthropic();
  const prompt = buildAuditPrompt(context);

  let raw: string;
  try {
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
    raw = textBlock.text;
  } catch (err) {
    process.stderr.write(
      `prompt-audit: Claude API call failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    throw new Error(
      `Failed to generate audit card: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Strip accidental markdown fences
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Claude returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in parsed)) {
      throw new Error(`Claude response missing required field: "${field}"`);
    }
  }

  return {
    promptEventId: context.promptEvent.id,
    commitHash: context.commitHash,
    file: context.file,
    functionName: context.functionName,
    linesChanged: { start: context.startLine, end: context.endLine },
    what: parsed.what as string,
    decisions: parsed.decisions as string[],
    risks: parsed.risks as { message: string; severity: "low" | "medium" | "high" }[],
    testssuggested: parsed.testssuggested as string[],
    trustStatus: parsed.trustStatus as "unverified" | "verified" | "flagged",
    createdAt: getCurrentTimestamp(),
  };
}
