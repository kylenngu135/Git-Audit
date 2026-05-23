# prompt-audit MCP Server

This MCP server captures AI prompts at the moment they are submitted to Claude Code and writes them as structured JSON records to `.audit/events/`. It acts as the entry point for the prompt-audit workflow: every prompt gets an ID and a timestamp before any code changes happen, so there is always a traceable link between what was asked and what was committed.

## Connecting to Claude Code

Copy `mcp.json` from the project root into your project, or manually add the `prompt-audit` entry to your existing Claude Code MCP config at `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "prompt-audit": {
      "command": "node",
      "args": ["--import", "tsx/esm", "src/mcp/server.ts"],
      "env": {}
    }
  }
}
```

## The `capture_prompt` tool

Claude Code calls `capture_prompt` automatically at the start of each session or task. It receives the raw prompt text and the name of the AI tool in use, generates a unique event ID, and writes a `PromptEvent` record to `.audit/events/{id}.json` with status `"pending"`. The event stays pending until it is linked to a commit by a git hook and later reviewed and audited.

## Storage

All captured prompt events are stored as JSON files in `.audit/events/`. Each file is named `{eventId}.json` and contains the full `PromptEvent` record. These files are committed to the repository as part of the audit trail.
