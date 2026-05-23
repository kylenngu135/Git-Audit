import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

async function runGitCommand(command: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(command, { cwd });
    return stdout.trim();
  } catch (err: unknown) {
    const stderr = (err as { stderr?: string }).stderr?.trim() ?? "";
    throw new Error(`git command failed: \`${command}\`\n${stderr}`);
  }
}

export async function getCurrentCommitHash(repoRoot: string): Promise<string> {
  try {
    return await runGitCommand("git rev-parse HEAD", repoRoot);
  } catch (err) {
    throw new Error(`Failed to get current commit hash: ${(err as Error).message}`);
  }
}

export async function getDiffHunks(repoRoot: string): Promise<string> {
  try {
    return await runGitCommand("git diff HEAD~1 HEAD", repoRoot);
  } catch {
    // HEAD~1 doesn't exist (first commit) — try staged, then full show
    let cached = "";
    try { cached = await runGitCommand("git diff --cached HEAD", repoRoot); } catch { /* fall through */ }
    if (cached) return cached;
    try {
      return await runGitCommand("git show HEAD", repoRoot);
    } catch {
      return "";
    }
  }
}

export async function getChangedFiles(repoRoot: string): Promise<string[]> {
  let output: string;
  try {
    output = await runGitCommand("git diff --name-only HEAD~1 HEAD", repoRoot);
  } catch {
    // HEAD~1 doesn't exist (first commit) — try staged, then full show
    let cached = "";
    try { cached = await runGitCommand("git diff --cached --name-only HEAD", repoRoot); } catch { /* fall through */ }
    if (cached) {
      output = cached;
    } else {
      try {
        output = await runGitCommand("git show --name-only --format= HEAD", repoRoot);
      } catch {
        return [];
      }
    }
  }
  return output.split("\n").filter((f) => f.length > 0);
}
