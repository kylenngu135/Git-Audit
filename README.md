# git-audit

> The missing history layer for AI-assisted development.

git-audit captures every prompt you send to Claude Code,
links it to the code it produced, and generates structured
audit cards for every function that changed — automatically,
on every commit. The full decision history is committed
alongside your code and shared with your entire team via git.

**Platform support:** Linux and macOS. Windows not yet supported.

---

## The Problem

AI coding tools generate code faster than teams can trust it.
When Claude Code writes a function, the prompt that caused it,
the design decisions it made, and the risks it introduced all
disappear the moment the session ends.

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

Every time you prompt Claude Code, git-audit captures it
automatically as a prompt event via MCP. When you commit,
the post-commit hook:

1. Links the prompt to the commit hash
2. Detects every function that changed at the line level
3. Generates a structured audit card per function via
   Claude Code CLI (uses your existing Claude subscription —
   no separate API key required)
4. Commits the audit cards alongside your code automatically

Your teammates pull the code — the full context comes with it.

---

## Prerequisites

- Linux or macOS
- Node.js 18+
- npm
- Git
- Claude Code installed and authenticated
- A Claude Pro or Max subscription (used for audit card
  generation — no separate API key needed)

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

tsx is required to run the MCP server from any directory:

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
- Creates the .audit/ directory structure
- Installs the post-commit and pre-push git hooks
- Generates a configured mcp.json for Claude Code
- Registers the MCP server with Claude Code
- Configures ~/.claude/CLAUDE.md so Claude Code always
  calls capture_prompt before making changes

### Step 4 — Verify MCP is connected

Start Claude Code in your project:
```bash
claude
```

Ask it:
```
What MCP tools do you have available?
```

You should see capture_prompt listed. If not, run:
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
# 1. Use Claude Code — prompts captured automatically
claude

# 2. Commit as normal — hook fires automatically
git add -A && git commit -m "your message"

# 3. Watch audit cards generate in the terminal output
# git-audit: auditing processPayment in src/payments/handler.ts...
# git-audit: ✓ processPayment — 1 risk(s) found
# git-audit: audit complete in 8.3s — 3 succeeded, 0 failed
```

---

## CLI Commands

```bash
# Codebase-wide trust and risk overview
audit status

# Full prompt event history
audit log

# Complete audit history for a specific function
audit show <functionName>

# Check for design philosophy conflicts before merging
audit merge <source-branch>

# Show help
audit help
```

---

## Example Output

### audit status

```
┌─────────────────────────────────────────────────────┐
│  git-audit — codebase trust report                  │
└─────────────────────────────────────────────────────┘

  Functions audited     4
  Avg trust score       87/100
  Unverified            4

  Risk summary
  ────────────
  🔴 High      0
  🟡 Medium    1

  All functions
  ─────────────
  [75/100] divide — src/example/calculator.ts
  [90/100] add — src/example/calculator.ts
  [90/100] multiply — src/example/calculator.ts
  [90/100] subtract — src/example/calculator.ts

  Run 'audit show <function>' for full audit history.
```

### audit show add

```
┌─────────────────────────────────────────────────────┐
│  git-audit — add                                    │
└─────────────────────────────────────────────────────┘

  File          src/example/calculator.ts
  Audits        1
  Open risks    0
  Trust score   90/100  █████████░

  ─────────────────────────────────────────────────────
  Audit 1 of 1 — 5/23/2026
  Commit: a22d254
  Prompt: "create a calculator module with add and divide..."

  What changed
  ────────────
  The add function accepts two numeric arguments and
  returns their sum with basic input validation.

  Design decisions
  ────────────────
  1. Chose Number.isFinite over typeof checks because it
     correctly rejects NaN and Infinity

  Risks
  ─────
  ✓ No risks flagged

  Suggested tests
  ───────────────
  □ Given valid integers when add(2, 3) then returns 5
  □ Given NaN input when add(NaN, 1) then throws TypeError
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
  Audit conflict 1 of 1
  ─────────────────────────────────────────────────────
  Function:  processPayment
  Type:      direct-opposition
  Severity:  🔴 high

  Branch "feature/caching" intent:
    Cache validation results for performance

  Branch "main" intent:
    Always validate fresh for compliance

  Why this conflicts:
    Caching vs always-verify are mutually exclusive
```

---

## How Audit Cards Work

Each function touched by a Claude Code prompt gets a
structured audit card containing:

- **What** — plain English explanation of what changed
- **Decisions** — each design decision as "Chose X over Y
  because Z"
- **Risks** — flagged edge cases with severity levels
  (low / medium / high)
- **Suggested tests** — specific test cases to verify before
  shipping

Cards are stored in .audit/functions/ and committed to your
repo automatically on every commit.

---

## Repository Structure

After running audit init, your repo will have:

```
your-project/
  .audit/
    events/          ← prompt events and changesets
    functions/       ← audit cards and function records
    conflicts/       ← merge conflict reports
  .git/
    hooks/
      post-commit    ← auto-generates audit cards on commit
      pre-push       ← warns before pushing high-risk functions
  mcp.json           ← Claude Code MCP configuration (gitignored)
```

---

## Audit Merge Conflicts

Before merging branches, run:

```bash
audit merge feature/my-branch
```

git-audit compares the design philosophies from both branches
and flags contradictions that git cannot detect — such as one
branch caching aggressively while another requires fresh
verification on every call for compliance reasons.

You resolve conflicts at the intent level. Your resolution is
recorded permanently in the audit history so future developers
understand why the system works the way it does.

git does not run automatically — audit merge is a read-only
analysis tool. Run git merge separately after resolving.

---

## Pre-Push Safety Gate

Before every git push, git-audit checks for functions with
unresolved high severity risks or trust scores below 50.
If any are found, it warns you and asks for confirmation.

To bypass for a single push:
```bash
git push --no-verify
```

---

## Codebase Convention Learning

As your audit history grows, git-audit automatically extracts
patterns from past audit cards and injects them as context
into every new audit. This means:

- New functions are audited relative to your team's established
  patterns, not generic best practices
- Recurring failure modes get flagged more precisely over time
- Conventions are applied automatically — you never need to
  re-explain your standards to the auditor
