# git-audit — Demo Script

## Before Judges Arrive (Setup)

```bash
# Run setup script
bash demo/setup.sh

# Go to demo repo
cd /tmp/git-audit-demo

# Verify branches exist
git branch
# Should show: feature/compliance-strict
#              feature/performance-caching
#            * master (or main)

# Verify audit status works
audit status

# Start Claude Code — leave this running
claude
```

Confirm Claude Code shows capture_prompt available:
Ask: "What MCP tools do you have available?"

If not connected run:
```bash
claude mcp add git-audit $(which tsx) /path/to/git-audit/src/mcp/server.ts
```

---

## The Demo (5 minutes)

### Opening (30 seconds)

Show the starting file:
```bash
cat src/payments/handler.ts
```

Say:
> "This is our payment handler. It works, but it has no
> error handling. We're going to ask Claude Code to fix
> that — and show you exactly what git-audit captures."

---

### Step 1 — Live prompt to Claude Code (1 minute)

In the Claude Code session, send this prompt:
```
Add comprehensive error handling to both functions in
src/payments/handler.ts. Throw descriptive typed errors
for all invalid inputs. Add a retry mechanism to
processPayment for transient failures with exponential
backoff, maximum 3 attempts.
```

Point out to judges:
> "Notice Claude Code automatically called capture_prompt
> before making any changes. That's git-audit capturing
> the intent behind these changes."

---

### Step 2 — Commit and watch the pipeline (45 seconds)

```bash
git add -A && git commit -m "add error handling and retry logic"
```

Point out the terminal output as it runs:
> "The post-commit hook just fired. It's detecting which
> functions changed, sending them to Claude for analysis,
> and generating audit cards — all automatically. No extra
> steps from us."

Wait for completion. Should take 10-20 seconds.

---

### Step 3 — Show audit status (30 seconds)

```bash
audit status
```

Say:
> "This is our codebase trust report. Every AI-generated
> function has a trust score based on open risks.
> This updates automatically on every commit."

---

### Step 4 — Show audit show (1 minute)

```bash
audit show processPayment
```

Walk through the output:
> "Here's what any developer on our team sees when they
> pull this branch. The original prompt. The design
> decisions Claude made and why. The risks flagged.
> The suggested tests. All without asking anyone anything."

Point specifically at the decisions section:
> "Chose exponential backoff over fixed delay — Claude
> reasoned about this. That reasoning is now permanent."

---

### Step 5 — Show audit log (30 seconds)

```bash
audit log
```

Say:
> "This is our prompt history. Every AI interaction that
> touched this codebase, in order, linked to the commit
> it produced. Git tracks what changed — git-audit tracks
> why."

---

### Step 6 — The merge conflict moment (1 minute)

This is the wow moment. Set it up:

> "Here's the problem git-audit was really built to solve.
> We have two feature branches. Both compile. Both pass
> tests. Git sees zero conflicts. But watch this."

```bash
git checkout feature/compliance-strict
audit merge feature/performance-caching
```

When it detects the conflict, say:
> "One branch optimized for performance — cache validation
> results for 5 minutes. The other branch hardened for
> PCI-DSS compliance — never cache validation results.
> Git sees no conflict. git-audit caught a design
> contradiction that would have caused either a compliance
> failure or a silent security regression in production."

Resolve it live — pick option 3, write:
```
PCI-DSS compliance takes priority — validation must always
be fresh. Performance optimization should use request
deduplication instead of result caching.
```

Say:
> "That resolution is now permanently recorded in our
> audit history. Future developers will know exactly why
> we made this decision."

---

### Closing (30 seconds)

```bash
audit log
```

Show the merge resolution event in the log.

Say:
> "Git tells you what changed. git-audit tells you why.
> Every prompt, every design decision, every risk, every
> architectural choice — permanently committed alongside
> the code. Shared with every developer automatically
> through git push and pull. No extra tools, no extra
> steps."

---

## If Something Goes Wrong

**capture_prompt not called automatically:**
```bash
# Manually call it in Claude Code session
Call capture_prompt with prompt "add error handling and retry logic"
```

**Audit cards not generating after commit:**
```bash
# Check ANTHROPIC_API_KEY is set as fallback
echo $ANTHROPIC_API_KEY
# Check hook is installed
cat .git/hooks/post-commit
```

**audit merge shows no conflicts:**
```bash
# Make sure you're on feature/compliance-strict, not master
git checkout feature/compliance-strict
audit merge feature/performance-caching

# Verify both branches have audit files
git show feature/performance-caching:.audit/functions/ 2>/dev/null || echo "no audit files on branch"
# If empty, the pre-built audit cards may not have committed
# Re-run: bash demo/reset.sh
```

**Push to bypass pre-push hook if needed:**
```bash
git push --no-verify
```

---

## Key Talking Points

- "Git tracks what. git-audit tracks why."
- "Works with any MCP-compatible AI tool — not just Claude Code."
- "The audit history is just JSON files committed to your repo —
   no external database, no extra infrastructure."
- "Uses your existing Claude subscription — no separate API key."
- "The more your team uses AI, the more valuable the history becomes."
- "audit merge catches design contradictions git never could."

---

## Reset Between Runs

```bash
bash demo/reset.sh
```
