# git-audit

> The missing history layer for AI-assisted development.

git-audit captures every prompt you send to Claude Code, links it to the code it produced, and generates structured audit cards for every function that changed — automatically, on every commit. The full decision history is committed alongside your code and shared with your entire team via git.

## The problem

AI coding tools generate code faster than teams can trust it. When Claude Code writes a function, the prompt that caused it, the design decisions it made, and the risks it introduced all disappear the moment the session ends.

Git saves *what* changed. It has no idea *why*.

This creates compounding problems:
- **Code review** — reviewers reverse-engineer intent from diffs with no context
- **Debugging** — bugs in AI-generated code have no traceable decision history
- **Onboarding** — new developers inherit functions with no explanation of why they work the way they do
- **Team collaboration** — context lives in one developer's head and disappears when they're unavailable

## How it works

Every time you prompt Claude Code, git-audit captures it as a prompt event. When you commit, the post-commit hook:

1. Links the prompt to the commit
2. Detects every function that changed at the line level
3. Sends each function to Claude for analysis
4. Generates a structured audit card with decisions and risks
5. Commits the audit cards alongside your code automatically

Your teammates pull the code and the full context comes with it.

## Installation

### Prerequisites

You need `node` (18+), `git`, `tsx`, and the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI on your PATH, plus an [Anthropic API key](https://console.anthropic.com/settings/keys).

```bash
# Install the npm-managed pieces if they're missing
npm install -g tsx @anthropic-ai/claude-code
```

### One-time setup (per machine)

```bash
git clone git@github.com:kylenngu135/Git-Audit.git
cd Git-Audit
npm install
npm run build
npm link

# Export your API key so commit-time audits can call Claude
echo 'export ANTHROPIC_API_KEY=sk-ant-...' >> ~/.bashrc   # or ~/.zshrc
source ~/.bashrc
```

The `audit` command is now globally available.

### Per-project setup

```bash
cd your-project          # any git repo
audit init               # creates .audit/, installs hooks, writes mcp.json
```

`audit init` auto-detects your `tsx` path on this host — no hardcoded paths. At the end it prints a ready-to-copy `claude mcp add ...` command. Run that once per project to register the MCP server with Claude Code, then start Claude Code from the project root and you're done.

## Usage

Use Claude Code normally. Commit normally. git-audit runs in the background.

```bash
# See codebase trust overview
audit status

# See all prompt events
audit log

# Full audit history for a function
audit show processPayment

# Check for design conflicts before merging
audit merge feature/my-branch
```

## Example output

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
```

### audit show add
```
┌─────────────────────────────────────────────────────┐
│  git-audit — add                                    │
└─────────────────────────────────────────────────────┘

  File          src/example/calculator.ts
  Audits        1
  Open risks    0
  Trust score   100/100  ██████████

  Design decisions
  ────────────────
  1. Chose to throw TypeError for non-finite inputs over
     returning null because callers should know explicitly
     when inputs are invalid

  Risks
  ─────
  ✓ No risks flagged

  Suggested tests
  ───────────────
  □ Given valid integers when add(2, 3) then returns 5
  □ Given NaN input when add(NaN, 1) then throws TypeError
```

## How audit cards work

Each function touched by a Claude Code prompt gets an audit card containing:

- **What** — plain English explanation of what changed
- **Decisions** — each design decision formatted as "Chose X over Y because Z"
- **Risks** — flagged edge cases with severity levels
- **Suggested tests** — specific test cases to verify

Cards are stored in .audit/functions/ and committed to your repo automatically.

## Audit merge conflicts

Before merging branches, run:

```bash
audit merge feature/my-branch
```

git-audit compares the design philosophies from both branches and flags contradictions that git cannot detect — like one branch caching aggressively while another requires fresh verification on every call. You resolve conflicts at the intent level, and the resolution is recorded in your audit history.

## Tech stack

- Node.js + TypeScript
- Anthropic MCP SDK (model-agnostic prompt capture)
- Claude Sonnet (audit card generation)
- Git hooks (post-commit, pre-push)
- Plain JSON files committed to your repo

## License

MIT
