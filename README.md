# git-audit

> The missing history layer for AI-assisted development.

git-audit captures every prompt you send to Claude Code,
links it to the code it produced, and writes a structured
audit card for every function that changed — automatically,
on every commit. The full decision history is committed
alongside your code and shared with your entire team via git.

**Platform support:** Linux and macOS. Windows not yet supported.
**Languages detected:** TypeScript, JavaScript, TSX, JSX, Python.

---

## The Problem

AI coding tools generate code faster than teams can trust it.
When Claude Code writes a function, the prompt that caused it,
the intent behind it, and the response Claude gave all disappear
the moment the session ends.

Git saves *what* changed. It has no idea *why*.

This creates compounding problems across your entire workflow:

- **Code review** — reviewers reverse-engineer intent from
  diffs with no context
- **Debugging** — bugs in AI-generated code have no
  traceable decision history
- **Onboarding** — new developers inherit functions with
  no explanation of why they work the way they do
- **Team collaboration** — context lives in one developer's
  head and disappears when they're unavailable

---

## How It Works

Every time you prompt Claude Code, git-audit captures it as a
pending prompt event via two MCP tools:

- `capture_prompt` — called before changes, records the raw
  prompt, your one-line intention, and the AI tool used
- `capture_response` — called after changes, records the
  response summary and the list of files Claude modified

When you commit, the post-commit hook:

1. Picks up the most recent pending prompt event
2. Diffs the commit and detects every changed function at
   the line level (TS, JS, TSX, JSX, and Python)
3. Writes one audit card per function with the prompt,
   intention, and Claude's response summary attached
4. Marks the event `audited` and commits the cards alongside
   your code automatically

Your teammates pull the code — the full context comes with it.

---

## Prerequisites

- Linux or macOS
- Node.js 18+
- npm
- Git
- Claude Code installed and authenticated

---

## Installation

### Step 1 — Clone and install globally

```bash
git clone https://github.com/yourusername/git-audit
cd git-audit
npm install
npm run build
npm link
```

Verify the global command works:
```bash
which audit
audit help
```

### Step 2 — Install tsx globally

tsx is required to run the hook scripts and the MCP server
in a non-interactive shell:

```bash
npm install -g tsx
```

### Step 3 — Set up in any repo

Navigate to the project you want to audit and run:

```bash
cd your-project
audit init
```

This automatically:
- Creates the `.audit/` directory structure
- Installs the `post-commit` and `pre-push` git hooks
  (using absolute paths to tsx and the hook scripts so they
  work in any shell)
- Generates a configured `mcp.json` for Claude Code
- Registers the MCP server with Claude Code
- Configures `~/.claude/CLAUDE.md` so Claude Code always
  calls `capture_prompt` before changes and `capture_response`
  after them

If a git-audit hook already exists, `audit init` rewrites it
in place; if a non-git-audit hook exists, init warns and
prints the snippet to add manually.

### Step 4 — Verify MCP is connected

Start Claude Code in your project:
```bash
claude
```

Ask it:
```
What MCP tools do you have available?
```

You should see `capture_prompt` and `capture_response` listed.
If not, run:
```bash
claude mcp list
```

If git-audit is not connected, add it manually:
```bash
claude mcp add git-audit $(which tsx) /absolute/path/to/git-audit/src/mcp/server.ts
```

---

## Daily Workflow

Use Claude Code normally. Commit normally. git-audit runs
in the background automatically.

```bash
# 1. Use Claude Code — capture_prompt/capture_response fire automatically
claude

# 2. Commit as normal — the post-commit hook does the rest
git add -A && git commit -m "your message"

# 3. Watch the hook output
# git-audit: changed files: math_ops.py
# git-audit: detected 2 function(s)
# git-audit: ✓ add in math_ops.py
# git-audit: ✓ sub in math_ops.py
# git-audit: 2 card(s) saved. Run 'audit show <function>' to view.
```

If you commit without a pending prompt event (e.g. a hand-typed
commit), the hook prints `git-audit: no pending prompt event
found. Did you forget to use capture_prompt?` and exits cleanly
— it never blocks the commit.

---

## CLI Commands

```bash
audit init              # Set up git-audit in this repo
audit status            # Codebase overview: tracked functions + recent activity
audit log               # Full prompt event history
audit show <function>   # Audit history for a specific function
audit merge <branch>    # Check for audit conflicts before merging
audit help              # Show this help text
```

---

## Example Output

### audit status

```
┌─────────────────────────────────────────────────────┐
│  git-audit — codebase overview                      │
└─────────────────────────────────────────────────────┘

  Functions tracked     6
  Prompt events         5

  Recent activity
  ───────────────

  ✅ 5/23/2026 — "Modify add() in math_ops.py"
         Intent: "Verify Python detection picks up changes inside add()"
  ✅ 5/23/2026 — "write mult and div in python now"
         Intent: "adding multiplication and division functions to the Python m"

  All tracked functions
  ─────────────────────

  divide — math_ops.js — 1 audit(s)
  mult   — math_ops.js — 1 audit(s)
  add    — math_ops.py — 1 audit(s)
  sub    — math_ops.py — 3 audit(s)

  ─────────────────────────────────────────────────────
  Run 'audit show <function>' for full history.
```

### audit show add

```
┌─────────────────────────────────────────────────────┐
│  git-audit — add                                    │
└─────────────────────────────────────────────────────┘

  File          math_ops.py
  Audits        1

  ─────────────────────────────────────────────────────
  5/23/2026 — commit 63f37c7

  Intention
  ─────────
  Verify Python detection picks up changes inside add()

  Prompt
  ──────
  Modify add() in math_ops.py

  Claude's response
  ─────────────────
  Added a comment above the return inside add(); behavior
  unchanged.

  ─────────────────────────────────────────────────────
  Run 'audit status' for codebase overview.
```

### audit merge

```
┌─────────────────────────────────────────────────────┐
│  git-audit — checking for audit conflicts           │
└─────────────────────────────────────────────────────┘

  Checking audit histories between feature/caching and main...

  ⚠  1 audit conflict detected
     These are design-level conflicts git cannot see.

  ─────────────────────────────────────────────────────
  Function:  processPayment
  Branch "feature/caching" intent:
    Cache validation results for performance
  Branch "main" intent:
    Always validate fresh for compliance

  Why this conflicts:
    Caching vs always-verify are mutually exclusive
```

---

## What's in an Audit Card

Each function touched by a Claude Code prompt gets a card
with these fields:

- **functionName** — name detected from the source
- **file** — repo-relative path
- **commitHash** — the commit that produced the change
- **prompt** — the user's raw prompt to Claude
- **intention** — the one-line "why" Claude recorded via
  `capture_prompt`
- **responseSummary** — 2–3 sentence summary Claude wrote
  via `capture_response`
- **createdAt** — ISO timestamp

Cards live in `.audit/functions/` next to a per-function
`*_record.json` that aggregates the audit history. Both are
committed to your repo automatically.

---

## Function Detection

`audit init` processes any file ending in `.ts`, `.js`,
`.tsx`, `.jsx`, or `.py`.

- **JS/TS** — detects `function foo()`, `const foo = () =>`,
  and method shorthand inside classes; function bodies are
  bounded by brace depth.
- **Python** — detects `def`, `async def`, and `def` indented
  4 spaces (class methods); function bodies are bounded by
  indentation (the function ends at the dedent back to the
  `def` line's level).

When a diff hunk overlaps multiple functions, every function
it touches gets an audit card. Hunks outside any function are
attributed to `module-level`.

---

## Repository Structure

After running `audit init`, your repo will have:

```
your-project/
  .audit/
    events/          ← prompt events (one JSON per capture_prompt)
    functions/       ← audit cards + per-function records
    conflicts/       ← audit merge conflict reports
  .git/
    hooks/
      post-commit    ← generates audit cards on every commit
      pre-push       ← prints an audit summary before push
  mcp.json           ← Claude Code MCP configuration (gitignored)
```

---

## Audit Merge Conflicts

Before merging branches, run:

```bash
audit merge feature/my-branch
```

git-audit compares the intents recorded on both branches and
flags contradictions that git cannot detect — such as one
branch caching aggressively while another requires fresh
verification on every call for compliance reasons.

You resolve conflicts at the intent level. `audit merge` is a
read-only analysis tool; run `git merge` separately after
reviewing.

---

## Pre-Push Summary

Before every `git push`, git-audit prints a one-line summary
of how many functions are tracked and how many total audits
exist on this branch. It does not block the push.

To skip the hook entirely:
```bash
git push --no-verify
```
