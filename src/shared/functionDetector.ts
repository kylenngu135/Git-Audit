import fs from "node:fs/promises";
import path from "node:path";
import type { DiffHunk } from "./diffParser.js";

export interface DetectedFunction {
  name: string;
  startLine: number;
  endLine: number;
  file: string;
}

const PATTERNS: Array<{ regex: RegExp; nameGroup: number }> = [
  { regex: /^(export\s+)?(async\s+)?function\s+(\w+)\s*\(/, nameGroup: 3 },
  { regex: /^(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(/, nameGroup: 3 },
  { regex: /^\s{2,}(async\s+)?(\w+)\s*\([^)]*\)\s*\{/, nameGroup: 2 },
  { regex: /^\s+(async\s+)?(\w+)\s*\([^)]*\)\s*\{/, nameGroup: 2 },
];

export async function detectFunctionsInFile(filePath: string): Promise<DetectedFunction[]> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const starts: Array<{ name: string; startLine: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    for (const { regex, nameGroup } of PATTERNS) {
      const match = line.match(regex);
      if (match) {
        const name = match[nameGroup];
        if (name) {
          starts.push({ name, startLine: i + 1 });
          break;
        }
      }
    }
  }

  return starts.map((fn, idx) => ({
    name: fn.name,
    startLine: fn.startLine,
    endLine: idx + 1 < starts.length ? starts[idx + 1].startLine - 1 : lines.length,
    file: filePath,
  }));
}

export async function mapHunksToFunctions(
  hunks: DiffHunk[],
  filePath: string
): Promise<Map<string, DiffHunk[]>> {
  const functions = await detectFunctionsInFile(filePath);
  const result = new Map<string, DiffHunk[]>();

  for (const hunk of hunks) {
    const fn = functions.find(
      (f) => hunk.startLine >= f.startLine && hunk.startLine <= f.endLine
    );
    const key = fn ? fn.name : "module-level";
    const bucket = result.get(key);
    if (bucket) {
      bucket.push(hunk);
    } else {
      result.set(key, [hunk]);
    }
  }

  return result;
}

const SUPPORTED_EXTENSIONS = new Set([".ts", ".js", ".tsx", ".jsx", ".py"]);

export async function getFunctionsChangedInCommit(
  changedFiles: string[],
  hunks: DiffHunk[],
  repoRoot: string
): Promise<Map<string, DetectedFunction & { hunks: DiffHunk[] }>> {
  type Entry = { file: string; func: DetectedFunction; hunks: DiffHunk[] };
  const entries: Entry[] = [];

  for (const file of changedFiles) {
    if (!SUPPORTED_EXTENSIONS.has(path.extname(file))) continue;

    const absolutePath = path.join(repoRoot, file);
    const fileHunks = hunks.filter((h) => h.file === file);
    if (fileHunks.length === 0) continue;

    let functions: DetectedFunction[];
    try {
      functions = await detectFunctionsInFile(absolutePath);
    } catch {
      continue;
    }

    let hunkMap: Map<string, DiffHunk[]>;
    try {
      hunkMap = await mapHunksToFunctions(fileHunks, absolutePath);
    } catch {
      continue;
    }

    for (const [funcName, funcHunks] of hunkMap) {
      const detected = functions.find((f) => f.name === funcName);
      const func: DetectedFunction = detected ?? {
        name: funcName,
        startLine: 0,
        endLine: 0,
        file: absolutePath,
      };
      entries.push({ file, func, hunks: funcHunks });
    }
  }

  const nameCounts = new Map<string, number>();
  for (const { func } of entries) {
    nameCounts.set(func.name, (nameCounts.get(func.name) ?? 0) + 1);
  }

  const result = new Map<string, DetectedFunction & { hunks: DiffHunk[] }>();
  for (const { file, func, hunks: funcHunks } of entries) {
    const key =
      (nameCounts.get(func.name) ?? 0) > 1
        ? `${path.basename(file)}:${func.name}`
        : func.name;
    result.set(key, { ...func, hunks: funcHunks });
  }

  return result;
}
