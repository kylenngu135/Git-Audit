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
- Node.js 18+
- npm
- Git
- An Anthropic API key

### Install globally

```bash
git clone https://github.com/yourusername/git-audit
cd git-audit
npm install
npm run build
npm link
```

### Set up in any repo

```bash
cd your-project
audit init
```

This creates the .audit/ directory structure, installs the post-commit and pre-push hooks, and generates a configured mcp.json for Claude Code.

### Connect Claude Code

```bash
claude mcp add git-audit $(which tsx) /path/to/git-audit/src/mcp/server.ts
```

### Set your API key

Add to your shell profile (~/.zshrc or ~/.bashrc):
```bash
export ANTHROPIC_API_KEY=your_key_here
```

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
