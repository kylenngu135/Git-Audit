import path from "path";
import fs from "fs/promises";
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

export async function runInit(): Promise<void> {
  // Step 1 — Find repo root
  let repoRoot: string;
  try {
    repoRoot = await findRepoRoot(process.cwd());
  } catch (err) {
    console.error(`[prompt-audit] Error: ${(err as Error).message}`);
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

  console.log("[prompt-audit] .audit/ directory structure created");

  // Step 3 — Install the post-commit git hook
  const hooksDir = path.join(repoRoot, ".git", "hooks");
  const hookPath = path.join(hooksDir, "post-commit");
  const hookScriptPath = path.join(installRoot, "dist", "hooks", "post-commit.js");
  const nodeCommand = `node ${hookScriptPath}`;
  const hookContent = `#!/bin/sh\n${nodeCommand}\n`;

  if (await existsAt(hookPath)) {
    const existing = await fs.readFile(hookPath, "utf-8");
    if (existing.includes("prompt-audit")) {
      console.log("[prompt-audit] post-commit hook already installed, skipping");
    } else {
      console.warn(
        "[prompt-audit] WARNING: a post-commit hook already exists. " +
          "Please manually add the following line to your existing hook:"
      );
      console.warn(`  ${nodeCommand}`);
    }
  } else {
    await fs.writeFile(hookPath, hookContent);
    await fs.chmod(hookPath, 0o755);
    console.log("[prompt-audit] post-commit hook installed");
  }

  // Step 4 — Write the MCP server config
  const mcpConfigPath = path.join(repoRoot, "mcp.json");
  const mcpServerPath = path.join(installRoot, "dist", "mcp", "server.js");

  if (await existsAt(mcpConfigPath)) {
    console.log("[prompt-audit] mcp.json already exists, skipping");
  } else {
    const mcpConfig = {
      mcpServers: {
        "prompt-audit": {
          command: "node",
          args: [mcpServerPath],
          env: {},
        },
      },
    };
    await fs.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n");
  }
  console.log("[prompt-audit] mcp.json written");

  // Step 5 — Final instructions
  console.log(`
[prompt-audit] Setup complete. Next steps:
  1. Add mcp.json to your Claude Code MCP configuration
  2. Start the MCP server: npm run start:mcp
  3. Use Claude Code normally — prompts will be captured automatically
  4. After each git commit, the post-commit hook will link your prompt to the commit and detect changed functions
  5. Run: node --import tsx/esm src/cli/status.ts to see audit status`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runInit();
}
