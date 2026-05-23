import path from "path";
import fs from "fs/promises";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { findRepoRoot } from "../shared/eventStore.js";

const execAsync = promisify(exec);

const installRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../"
);

async function existsAt(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createIfAbsent(filePath: string, content = ""): Promise<void> {
  if (!(await existsAt(filePath))) {
    await fs.writeFile(filePath, content);
  }
}

const TSX_FALLBACK_PATH = "/home/kylenngu/.npm-global/bin/tsx";

async function detectTsxPath(): Promise<string> {
  for (const probe of ["command -v tsx", "which tsx"]) {
    try {
      const { stdout } = await execAsync(probe);
      const candidate = stdout.trim().split("\n")[0];
      if (candidate) {
        await fs.access(candidate);
        return candidate;
      }
    } catch {
      // try next probe
    }
  }
  try {
    await fs.access(TSX_FALLBACK_PATH);
    return TSX_FALLBACK_PATH;
  } catch {
    throw new Error(
      "could not find 'tsx' on PATH or at fallback location. Install it globally with:\n" +
        "  npm install -g tsx\n" +
        "Then re-run: audit init"
    );
  }
}

export async function runInit(): Promise<void> {
  // Step 1 — Find repo root
  let repoRoot: string;
  try {
    repoRoot = await findRepoRoot(process.cwd());
  } catch (err) {
    console.error(`[git-audit] Error: ${(err as Error).message}`);
    process.exit(1);
  }

  // Detect tsx once and reuse — the pre-push hook and mcp.json both need it
  let tsxPath: string;
  try {
    tsxPath = await detectTsxPath();
  } catch (err) {
    console.error(`[git-audit] Error: ${(err as Error).message}`);
    process.exit(1);
  }

  // Step 2 — Create .audit/ directory structure
  await fs.mkdir(path.join(repoRoot, ".audit"), { recursive: true });
  if (!(await existsAt(path.join(repoRoot, ".audit", "events")))) {
    await fs.mkdir(path.join(repoRoot, ".audit", "events"), { recursive: true });
  }
  if (!(await existsAt(path.join(repoRoot, ".audit", "functions")))) {
    await fs.mkdir(path.join(repoRoot, ".audit", "functions"), { recursive: true });
  }
  if (!(await existsAt(path.join(repoRoot, ".audit", "conflicts")))) {
    await fs.mkdir(path.join(repoRoot, ".audit", "conflicts"), { recursive: true });
  }

  await createIfAbsent(path.join(repoRoot, ".audit", ".gitkeep"));
  await createIfAbsent(path.join(repoRoot, ".audit", "events", ".gitkeep"));
  await createIfAbsent(path.join(repoRoot, ".audit", "functions", ".gitkeep"));
  await createIfAbsent(path.join(repoRoot, ".audit", "conflicts", ".gitkeep"));

  console.log("[git-audit] .audit/ directory structure created");

  // Step 3 — Install the post-commit git hook
  const hooksDir = path.join(repoRoot, ".git", "hooks");
  const hookPath = path.join(hooksDir, "post-commit");
  const hookScriptPath = path.join(installRoot, "src", "hooks", "post-commit.ts");
  const hookCommand = `${tsxPath} ${hookScriptPath}`;
  const hookContent = `#!/bin/sh\n${hookCommand}\n`;

  if (await existsAt(hookPath)) {
    const existing = await fs.readFile(hookPath, "utf-8");
    if (existing.toLowerCase().includes("git-audit")) {
      await fs.writeFile(hookPath, hookContent);
      await fs.chmod(hookPath, 0o755);
      console.log("[git-audit] post-commit hook updated");
    } else {
      console.warn(
        "[git-audit] WARNING: existing hook found that is not from git-audit. Add manually:"
      );
      console.warn(hookContent);
    }
  } else {
    await fs.writeFile(hookPath, hookContent);
    await fs.chmod(hookPath, 0o755);
    console.log("[git-audit] post-commit hook installed");
  }

  // Install the pre-push git hook
  const prePushPath = path.join(hooksDir, "pre-push");
  const prePushScriptPath = path.join(installRoot, "src", "hooks", "pre-push.ts");
  const prePushCommand = `${tsxPath} ${prePushScriptPath}`;
  const prePushContent = `#!/bin/sh\n${prePushCommand}\n`;

  if (await existsAt(prePushPath)) {
    const existing = await fs.readFile(prePushPath, "utf-8");
    if (existing.toLowerCase().includes("git-audit")) {
      await fs.writeFile(prePushPath, prePushContent);
      await fs.chmod(prePushPath, 0o755);
      console.log("[git-audit] pre-push hook updated");
    } else {
      console.warn(
        "[git-audit] WARNING: existing hook found that is not from git-audit. Add manually:"
      );
      console.warn(prePushContent);
    }
  } else {
    await fs.writeFile(prePushPath, prePushContent);
    await fs.chmod(prePushPath, 0o755);
    console.log("[git-audit] pre-push hook installed");
  }

  // Step 4 — Write the MCP server config
  const mcpConfigPath = path.join(repoRoot, "mcp.json");
  const mcpServerPath = path.join(installRoot, "src", "mcp", "server.ts");
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";

  if (await existsAt(mcpConfigPath)) {
    console.log("[git-audit] mcp.json already exists, skipping");
  } else {
    const mcpConfig = {
      mcpServers: {
        "git-audit": {
          command: tsxPath,
          args: [mcpServerPath],
          cwd: installRoot,
          env: {
            ANTHROPIC_API_KEY: apiKey,
          },
        },
      },
    };
    await fs.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n");
    console.log(
      "[git-audit] mcp.json written with absolute paths and API key — ready for Claude Code"
    );

    if (!apiKey) {
      console.log(
        `[git-audit] ANTHROPIC_API_KEY not set — audit cards will be generated via the Claude Code CLI ` +
          `(uses your Claude Pro/Max subscription). To enable the API as a fallback, add ANTHROPIC_API_KEY ` +
          `to mcp.json:\n  nano ${mcpConfigPath}`
      );
    }
  }

  // Add mcp.json to .gitignore (contains API key)
  const gitignorePath = path.join(repoRoot, ".gitignore");
  if (await existsAt(gitignorePath)) {
    const gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
    if (!gitignoreContent.split("\n").some((line) => line.trim() === "mcp.json")) {
      await fs.appendFile(gitignorePath, "\nmcp.json\n");
      console.log("[git-audit] mcp.json added to .gitignore (contains API key — do not commit)");
    }
  } else {
    await fs.writeFile(gitignorePath, "mcp.json\n");
    console.log("[git-audit] mcp.json added to .gitignore (contains API key — do not commit)");
  }

  // Step 6 — Create or update the global Claude Code CLAUDE.md
  const claudeDir = path.join(os.homedir(), ".claude");
  const claudeMdPath = path.join(claudeDir, "CLAUDE.md");
  await fs.mkdir(claudeDir, { recursive: true });

  const claudeMdSection = `# Global Claude Code Instructions

## git-audit Integration

For every coding task follow these two steps:

STEP 1 — Before making any changes:
Call capture_prompt with:
- prompt: the exact instruction I gave you
- intention: why I am making this change — the goal
  or problem being solved, in one sentence
- aiTool: "claude-code"
Save the returned event ID for step 2.

STEP 2 — After finishing all changes:
Call capture_response with:
- eventId: the ID returned from capture_prompt
- responseSummary: 2-3 sentences describing what you
  changed and any important implementation notes or
  caveats. Be concise and specific.
- filesChanged: array of every file path you modified

Always complete BOTH steps for every coding task.
Never skip capture_response after making changes.
`;

  // Always overwrite — upgrade old single-step config to two-step
  await fs.writeFile(claudeMdPath, claudeMdSection);
  console.log(
    "[git-audit] ~/.claude/CLAUDE.md configured — Claude Code will now call capture_prompt and capture_response automatically"
  );

  // Step 7 — Register MCP server with Claude Code CLI
  try {
    let registerTsxPath: string;
    try {
      const { stdout } = await execAsync("which tsx");
      registerTsxPath = stdout.trim();
      if (!registerTsxPath) {
        registerTsxPath = "/home/kylenngu/.npm-global/bin/tsx";
      }
    } catch {
      registerTsxPath = "/home/kylenngu/.npm-global/bin/tsx";
    }

    const claudeAddCmd = `claude mcp add git-audit ${registerTsxPath} ${mcpServerPath}`;
    try {
      await execAsync(claudeAddCmd);
      console.log("[git-audit] MCP server registered with Claude Code");
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; message?: string };
      const combined = `${e.stderr ?? ""}${e.stdout ?? ""}${e.message ?? ""}`;
      if (combined.includes("already exists") || combined.includes("already added")) {
        console.log("[git-audit] MCP server already registered with Claude Code — skipping");
      } else {
        console.warn(
          `[git-audit] WARNING: could not auto-register MCP server with Claude Code. Run this manually:\n  ${claudeAddCmd}`
        );
      }
    }
  } catch {
    console.warn(
      `[git-audit] WARNING: could not auto-register MCP server with Claude Code. Run this manually:\n  claude mcp add git-audit ${tsxPath} ${mcpServerPath}`
    );
  }

  // Final instructions
  console.log(`
[git-audit] Setup complete. Next steps:
  1. Use Claude Code normally — call capture_prompt before changes, capture_response after
  2. After each git commit, the post-commit hook will create audit cards instantly
  3. Run: audit status  to see results
  4. Run: audit show <function>  to inspect any function's audit history`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runInit();
}
