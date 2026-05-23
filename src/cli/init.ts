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
  throw new Error(
    "could not find 'tsx' on PATH. Install it globally with:\n" +
      "  npm install -g tsx\n" +
      "Then re-run: audit init"
  );
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
  const hookScriptPath = path.join(installRoot, "dist", "hooks", "post-commit.js");
  const nodeCommand = `node ${hookScriptPath}`;
  const hookContent = `#!/bin/sh\n${nodeCommand}\n`;

  if (await existsAt(hookPath)) {
    const existing = await fs.readFile(hookPath, "utf-8");
    if (existing.includes("git-audit")) {
      console.log("[git-audit] post-commit hook already installed, skipping");
    } else {
      console.warn(
        "[git-audit] WARNING: a post-commit hook already exists. " +
          "Please manually add the following line to your existing hook:"
      );
      console.warn(`  ${nodeCommand}`);
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
    if (existing.includes("git-audit") || existing.includes("pre-push.ts")) {
      console.log("[git-audit] pre-push hook already installed, skipping");
    } else {
      console.warn(
        "[git-audit] WARNING: a pre-push hook already exists. " +
          "Please manually add the following line to your existing hook:"
      );
      console.warn(`  ${prePushCommand}`);
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

Before making ANY code changes, you MUST always call the
capture_prompt MCP tool first with the exact prompt I gave you.

Rules:
1. When I give you a coding task, call capture_prompt FIRST
   before touching any files
2. Only start making changes AFTER capture_prompt returns
   a successful event ID
3. If capture_prompt is not available, tell me before proceeding
4. This applies to every coding task in every project
`;

  if (await existsAt(claudeMdPath)) {
    const existing = await fs.readFile(claudeMdPath, "utf-8");
    if (existing.includes("capture_prompt")) {
      console.log("[git-audit] ~/.claude/CLAUDE.md already configured");
    } else {
      const separator = existing.endsWith("\n") ? "\n" : "\n\n";
      await fs.appendFile(claudeMdPath, separator + claudeMdSection);
      console.log(
        "[git-audit] ~/.claude/CLAUDE.md configured — Claude Code will now call capture_prompt automatically"
      );
    }
  } else {
    await fs.writeFile(claudeMdPath, claudeMdSection);
    console.log(
      "[git-audit] ~/.claude/CLAUDE.md configured — Claude Code will now call capture_prompt automatically"
    );
  }

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
  1. Use Claude Code normally — prompts will be captured automatically
  2. After each git commit, the post-commit hook will link your prompt to the commit and detect changed functions
  3. Run: audit status  to see audit results

[git-audit] Audit cards are generated via Claude Code CLI (uses your Claude Pro/Max subscription).
No API key required. If Claude Code is unavailable, set ANTHROPIC_API_KEY as a fallback.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runInit();
}
