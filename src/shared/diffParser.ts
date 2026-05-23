import { fileURLToPath } from "node:url";

export interface DiffHunk {
  file: string;
  linesAdded: number;
  linesRemoved: number;
  startLine: number;
  endLine: number;
  rawContent: string;
}

export function parseDiff(rawDiff: string): DiffHunk[] {
  if (!rawDiff.trim()) return [];

  const lines = rawDiff.split("\n");
  const hunks: DiffHunk[] = [];

  let currentFile = "";
  let isBinary = false;
  let currentHunk: DiffHunk | null = null;
  let hunkLines: string[] = [];

  const finalizeHunk = () => {
    if (currentHunk !== null) {
      currentHunk.rawContent = hunkLines.join("\n");
      hunks.push(currentHunk);
      currentHunk = null;
      hunkLines = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      finalizeHunk();
      isBinary = false;
      const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
      currentFile = match ? match[1] : "";
      continue;
    }

    if (line.includes("Binary files")) {
      finalizeHunk();
      isBinary = true;
      continue;
    }

    if (isBinary) continue;

    if (line.startsWith("@@")) {
      finalizeHunk();
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        const newStart = parseInt(match[1], 10);
        const newCount = parseInt(match[2] ?? "1", 10);
        currentHunk = {
          file: currentFile,
          linesAdded: 0,
          linesRemoved: 0,
          startLine: newStart,
          endLine: newStart + newCount,
          rawContent: "",
        };
        hunkLines = [line];
      }
      continue;
    }

    if (currentHunk !== null) {
      hunkLines.push(line);
      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentHunk.linesAdded++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        currentHunk.linesRemoved++;
      }
    }
  }

  finalizeHunk();
  return hunks;
}

const FILTERED_EXTENSIONS = new Set([".json", ".lock", ".md", ".gitignore", ".env"]);

export function filterSignificantHunks(hunks: DiffHunk[]): DiffHunk[] {
  return hunks.filter((hunk) => {
    if (hunk.linesAdded === 0) return false;
    if (hunk.file.includes("node_modules") || hunk.file.includes(".audit/")) return false;
    const ext = hunk.file.slice(hunk.file.lastIndexOf("."));
    if (FILTERED_EXTENSIONS.has(ext)) return false;
    return true;
  });
}

export function groupHunksByFile(hunks: DiffHunk[]): Map<string, DiffHunk[]> {
  const groups = new Map<string, DiffHunk[]>();
  for (const hunk of hunks) {
    const existing = groups.get(hunk.file);
    if (existing) {
      existing.push(hunk);
    } else {
      groups.set(hunk.file, [hunk]);
    }
  }
  return groups;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sampleDiff = `diff --git a/src/auth.ts b/src/auth.ts
index abc1234..def5678 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,6 +10,8 @@ function login() {
 const user = getUser();
-if (user) {
+if (user && user.active) {
+  updateLastSeen(user.id);
   return user;
 }
@@ -25,4 +27,3 @@ function logout() {
 clearSession();
-console.log("logged out");
 return true;
diff --git a/src/utils.ts b/src/utils.ts
index 1111111..2222222 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,3 +1,5 @@ export function helper() {
+// version constant
+export const VERSION = "1.0.0";
 export function helper() {
   return true;
 }`;

  const hunks = parseDiff(sampleDiff);
  console.log("Parsed hunks:", JSON.stringify(hunks, null, 2));

  const significant = filterSignificantHunks(hunks);
  console.log("\nSignificant hunks:", significant.length);

  const grouped = groupHunksByFile(hunks);
  console.log("\nFiles with hunks:", [...grouped.keys()]);
}
