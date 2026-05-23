import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const RESERVED_KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "try", "catch", "finally",
  "with", "return", "typeof", "instanceof", "new", "delete", "void",
  "import", "export", "from", "of", "in", "yield", "await",
  "break", "continue", "throw", "case", "default",
]);

// Counts brace depth from startIdx to find the closing } of a function.
function findFunctionEndLine(lines: string[], startIdx: number): number {
  let depth = 0;
  let opened = false;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; opened = true; }
      else if (ch === "}") { depth--; }
    }
    if (opened && depth === 0) return i + 1; // convert to 1-based
  }
  return lines.length;
}

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
        if (name && !RESERVED_KEYWORDS.has(name)) {
          starts.push({ name, startLine: i + 1 });
          break;
        }
      }
    }
  }

  return starts.map((fn) => ({
    name: fn.name,
    startLine: fn.startLine,
    endLine: findFunctionEndLine(lines, fn.startLine - 1),
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
    // Find ALL functions whose line range overlaps this hunk (not just the first)
    const overlapping = functions.filter(
      (f) => hunk.startLine <= f.endLine && hunk.endLine >= f.startLine
    );

    const keys = overlapping.length > 0
      ? overlapping.map((f) => f.name)
      : ["module-level"];

    for (const key of keys) {
      const bucket = result.get(key);
      if (bucket) {
        bucket.push(hunk);
      } else {
        result.set(key, [hunk]);
      }
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const os = await import("node:os");
  let allPassed = true;

  // Test 1: basic detection (add + divide with nested if)
  {
    const tmpFile = path.join(os.tmpdir(), "git-audit-fn-test.ts");
    const testContent = `
export function add(a: number, b: number): number {
  return a + b;
}
export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error("Division by zero");
  }
  return a / b;
}
`;
    await fs.writeFile(tmpFile, testContent);
    const detected = await detectFunctionsInFile(tmpFile);
    await fs.unlink(tmpFile);

    console.log("Test 1 — basic detection:");
    for (const fn of detected) {
      console.log(`  ${fn.name}: lines ${fn.startLine}–${fn.endLine}`);
    }
    const names = detected.map((f) => f.name);
    if (names.includes("add") && names.includes("divide")) {
      console.log("  PASS: both 'add' and 'divide' detected");
    } else {
      console.error("  FAIL: found:", names);
      allPassed = false;
    }
  }

  // Test 2: single hunk spanning multiple functions maps to all of them
  {
    const tmpFile = path.join(os.tmpdir(), "git-audit-multi-fn-test.ts");
    // Functions at lines 1-3, 5-8, 10-15 (1-based after no leading blank)
    const testContent = `export function alpha(): void {
  return;
}
export function beta(): number {
  const x = 1;
  return x;
}
export function gamma(a: number, b: number): number {
  if (a > b) {
    return a;
  }
  return b;
}`;
    await fs.writeFile(tmpFile, testContent);

    const fakeHunk: DiffHunk = {
      file: tmpFile,
      linesAdded: 15,
      linesRemoved: 0,
      startLine: 1,
      endLine: 15,
      rawContent: "",
    };

    const hunkMap = await mapHunksToFunctions([fakeHunk], tmpFile);
    await fs.unlink(tmpFile);

    console.log("\nTest 2 — single spanning hunk maps to all functions:");
    for (const [name, hunks] of hunkMap) {
      console.log(`  ${name}: ${hunks.length} hunk(s)`);
    }
    const keys = [...hunkMap.keys()];
    if (keys.includes("alpha") && keys.includes("beta") && keys.includes("gamma")) {
      console.log("  PASS: all three functions detected from one spanning hunk");
    } else {
      console.error("  FAIL: expected alpha, beta, gamma — got:", keys);
      allPassed = false;
    }
  }

  if (!allPassed) process.exit(1);
}
