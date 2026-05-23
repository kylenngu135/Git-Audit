# git-audit demo

A 5-minute walkthrough designed to be run live in front of hackathon judges. The demo proves the core thesis — **git tracks what changed, git-audit tracks why** — and ends with a design-level merge conflict that git alone cannot see.

## Setup (before judges arrive)

```bash
# From the Git-Audit project root, with ANTHROPIC_API_KEY exported
bash demo/setup.sh
```

The setup script:
- builds a fresh repo at `/tmp/git-audit-demo`
- installs the git-audit hooks and writes a configured `mcp.json`
- registers the MCP server with Claude Code
- ships two pre-built branches (`feature/performance-mode`, `feature/strict-validation`) whose design intents directly contradict each other

Then open Claude Code in the demo repo:

```bash
cd /tmp/git-audit-demo
claude
```

Confirm the MCP server is connected:

> Ask Claude Code: **"what MCP tools do you have?"**
>
> You should see `capture_prompt` listed.

If something goes wrong, run `bash demo/reset.sh` and start over.

## Demo flow (in front of judges)

### Step 1 — Show the problem (30 seconds)

> "When Claude Code writes code, the reasoning disappears. Git saves what changed — not why. git-audit fixes that."

Show the starting file — two payment functions with no error handling.

```bash
cat src/payments/handler.ts
```

### Step 2 — Prompt Claude Code (1 minute)

Send Claude Code this exact prompt:

> Add comprehensive error handling to both functions in `src/payments/handler.ts`. Throw descriptive errors for invalid inputs. Add a retry mechanism to `processPayment` for transient failures.

Claude Code will edit the file. The prompt is automatically captured by the MCP server as a pending event.

### Step 3 — Commit and watch the pipeline (30 seconds)

```bash
git add -A && git commit -m "add error handling"
```

Watch the post-commit hook output as it scrolls. Call out three things:

1. `git-audit: detected change in function: ...`
2. `git-audit: generating audit cards via Claude...`
3. `git-audit: done. Run 'audit show' to see results.`

> "That's capturing the prompt, detecting which functions changed at the line level, and generating audit cards — automatically."

### Step 4 — Show audit status (30 seconds)

```bash
audit status
```

Point out the trust scores, the count of audited functions, and any flagged risks.

### Step 5 — Show audit show (1 minute)

```bash
audit show processPayment
```

Walk through:
- the **design decisions** Claude logged in "Chose X over Y because Z" form
- the **risks** it flagged with severity levels
- the **suggested tests** for verification

> "This is what your teammate sees when they pull your branch. Full context, zero questions. They don't have to interrogate the diff to figure out why error handling looks the way it does."

### Step 6 — Show audit log (30 seconds)

```bash
audit log
```

Show the prompt history with each prompt linked to its commit.

> "This is the missing history layer. Every prompt is a first-class event, permanently tied to the code it produced."

### Step 7 — Merge conflict demo (1 minute)

The pre-built branches `feature/performance-mode` and `feature/strict-validation` both change `processPayment`, but with opposite design intent. Git sees no conflict. git-audit does.

```bash
git checkout feature/performance-mode
audit merge feature/strict-validation
```

(The second argument defaults to the current branch, so checking out `feature/performance-mode` first lets you compare against it with a single-arg `audit merge`. Or run `audit merge feature/strict-validation feature/performance-mode` from any branch.)

Watch it surface the design contradiction — one branch decided to **always cache** validation results for performance, the other decided to **never cache** them for compliance. Pick a resolution live ("compliance wins"); the resolution gets recorded in audit history.

> "Git saw no conflict — both diffs apply cleanly. git-audit caught a design contradiction between two branches that would have shipped a silently-broken merge to production."

## Talking points

- "Git tracks what changed. git-audit tracks why."
- "Every audit card is committed to the repo — your teammates get full context automatically."
- "It works with any MCP-compatible AI tool — not just Claude Code."
- "The more you use it, the smarter it gets."
