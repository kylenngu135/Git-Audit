import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { PromptEvent } from "../shared/types.js";
import { generateId, getCurrentTimestamp } from "../shared/utils.js";
import { savePromptEvent, findRepoRoot } from "../shared/eventStore.js";

const server = new McpServer({ name: "prompt-audit", version: "0.1.0" });

server.tool(
  "capture_prompt",
  "Captures a developer prompt sent to an AI coding tool as a pending event in the audit history. Call this at the start of every coding session before making any changes.",
  {
    prompt: z.string().describe("The raw prompt the developer sent to the AI tool"),
    aiTool: z.string().optional().describe("The name of the AI tool being used, defaults to \"claude-code\""),
  },
  async ({ prompt, aiTool }) => {
    try {
      const id = generateId();
      const timestamp = getCurrentTimestamp();

      const event: PromptEvent = {
        id,
        timestamp,
        rawPrompt: prompt,
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
            text: `Prompt captured. Event ID: ${id}. Saved to ${filePath}. This event will be linked to your next git commit.`,
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
process.stderr.write("prompt-audit MCP server running\n");
