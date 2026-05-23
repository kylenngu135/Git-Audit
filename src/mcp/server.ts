import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { PromptEvent } from "../shared/types.js";
import { generateId, getCurrentTimestamp } from "../shared/utils.js";
import { savePromptEvent, findRepoRoot, loadPromptEvent, updatePromptEvent } from "../shared/eventStore.js";

const server = new McpServer({ name: "git-audit", version: "0.1.0" });

server.tool(
  "capture_prompt",
  "Call this before making any code changes. Records the developer prompt and their intention behind the change.",
  {
    prompt: z.string().describe("The exact instruction given to Claude"),
    intention: z.string().describe(
      'Why this change is being made — the goal or problem being solved. Example: "improving error handling so the API returns clear messages instead of crashing", or "refactoring for readability before adding new features"'
    ),
    aiTool: z.string().optional().describe('The name of the AI tool being used, defaults to "claude-code"'),
  },
  async ({ prompt, intention, aiTool }) => {
    try {
      const id = generateId();
      const timestamp = getCurrentTimestamp();

      const event: PromptEvent = {
        id,
        timestamp,
        rawPrompt: prompt,
        intention,
        responseSummary: undefined,
        filesChanged: undefined,
        status: "pending",
        linkedCommit: undefined,
        aiTool: aiTool ?? "claude-code",
      };

      await findRepoRoot(process.cwd());
      const filePath = await savePromptEvent(event);

      return {
        content: [
          {
            type: "text",
            text: `Prompt and intention captured. Event ID: ${id}. Call capture_response after finishing your changes.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: err instanceof Error ? err.message : String(err),
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "capture_response",
  "Call this after completing all code changes. Records Claude's response summary and the files modified.",
  {
    eventId: z.string().describe("The event ID returned by capture_prompt"),
    responseSummary: z.string().describe(
      "2-3 sentences describing what was changed and any important implementation notes or caveats"
    ),
    filesChanged: z.array(z.string()).describe("List of every file path that was modified"),
  },
  async ({ eventId, responseSummary, filesChanged }) => {
    try {
      const repoRoot = await findRepoRoot(process.cwd());
      await loadPromptEvent(eventId, repoRoot);
      await updatePromptEvent(
        eventId,
        { responseSummary, filesChanged },
        repoRoot
      );

      return {
        content: [
          {
            type: "text",
            text: `Response captured for event ${eventId}. Commit your changes to complete the audit card.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: err instanceof Error ? err.message : String(err),
          },
        ],
        isError: true,
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("git-audit MCP server running\n");
