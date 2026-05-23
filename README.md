# prompt-audit

### The missing history layer for AI-assisted development

---

## The Problem

AI coding tools like Claude Code, Cursor, and GitHub Copilot have fundamentally changed how software gets written. A prompt that used to take an hour to implement now takes seconds. Teams are shipping features at a pace that wasn't possible two years ago.

But this speed has introduced a new bottleneck that nobody has cleanly solved: **the reasoning behind AI-generated code is completely stateless.**

The moment a Claude Code session ends, three things disappear forever:

- The prompt that triggered the changes
- The design decisions the AI made and why
- The context a teammate would need to understand, review, or debug that code later

Git saves *what* changed. It has no idea *why*.

This creates compounding problems across the entire development lifecycle:

**During code review** — reviewers must reverse-engineer the intent behind AI-generated code from scratch. They see the diff but not the reasoning, the tradeoffs, or the risks the AI considered or missed. A 15-minute review becomes 45 minutes.

**During debugging** — when a bug surfaces in AI-generated code weeks later, the original context is gone. Nobody remembers which prompt caused it, what alternatives were considered, or why a specific implementation approach was chosen.

**During onboarding** — new developers joining a team that uses AI tooling inherit a codebase full of functions they can't trace back to any human decision. The "why does this work this way?" question has no answer.

**Across the team** — every developer using AI tools is making locally reasonable decisions that collectively create inconsistency. Without shared context, the same patterns get implemented differently across branches, and nobody notices until it causes a problem.

The faster AI generates code, the wider this gap gets. Teams are shipping at AI speed but understanding and trusting code at human speed. That is the bottleneck.

---

## What prompt-audit Is

prompt-audit is a **prompt-native version control layer** that runs alongside your existing git workflow. It treats every AI prompt as a first-class event in your project's history — the same way git treats every commit as a first-class event in your code's history.

Where git answers *what changed and who changed it*, prompt-audit answers *what the AI generated, why it made those choices, what the risks are, and whether anyone has verified it.*

The two histories run in parallel, permanently linked, stored directly in your repository.

---

## How It Works

### The Prompt Event

Every time a developer sends a prompt to Claude Code, prompt-audit captures it automatically before Claude Code writes a single line. This captured prompt becomes a **prompt event** — a structured record with a unique ID, timestamp, the raw prompt text, and a status that tracks its lifecycle from capture through audit.

The prompt event is the atomic unit of prompt-audit's history. Just as a git commit is the anchor for a code change, the prompt event is the anchor for everything that follows from it: the diff, the functions affected, the design decisions made, and the risks introduced.

### The Post-Commit Hook

When the developer commits the AI-generated changes, a git post-commit hook fires automatically. It performs three jobs:

First, it **links the prompt event to the commit** — connecting the intent to the code by associating the prompt's event ID with the git commit hash. The prompt event's status moves from `pending` to `linked`.

Second, it **extracts the diff at the function level** — not just which files changed, but which specific functions were created or modified, and which exact line ranges Claude Code wrote. This is done using hunk-level diff parsing combined with regex-based function boundary detection, identifying every function touched by the prompt without requiring the developer to mark anything manually.

Third, it **saves a changeset record** — a structured JSON file that describes exactly what the prompt caused: which functions changed, in which files, across how many lines.

### The Audit Pipeline

Once the changeset is saved, the audit pipeline runs automatically. For each function touched by the prompt, it assembles a context package containing the original prompt, the specific diff hunks for that function, and any prior audit history for that function from previous prompts.

This context package is sent to Claude via the Anthropic API. Claude returns a structured **audit card** — a machine-readable JSON record containing:

- **What** — a plain-English explanation of what the function now does after the change
- **Decisions** — each specific design decision the AI made, formatted as "Chose X over Y because Z"
- **Risks** — flagged edge cases, unhandled errors, and potential issues, each with a severity level of low, medium, or high
- **Suggested tests** — specific test cases in plain English, formatted as "Given X when Y then Z"
- **Trust status** — starts as `unverified`, can be moved to `verified` by a human or `flagged` if issues are found

The audit card is committed alongside the code as a follow-up micro-commit, so the reasoning history travels with the repo automatically.

### The Function Record

Each function in the codebase accumulates a **function record** — an append-only log of every prompt event that has ever touched it. The first time a function is audited, its record is created. Every subsequent prompt that modifies it adds a new entry.

The function record tracks the full arc of decisions that shaped a function over time: which prompt created it, which prompts modified it, which risks were introduced by which prompts, and which risks were later resolved. It also maintains a **trust score** — a numeric value from 0 to 100 derived from open risk count and severity, which degrades automatically when the function changes without a new audit.

### Shared Via Git

The entire `.audit/` directory is committed to the repository alongside the code. When a teammate pulls a branch, they pull the complete audit history too — all prompt events, all audit cards, all function records. No separate sync mechanism, no external database, no additional tooling required on the teammate's machine.

The audit history is co-located with the code it describes, version-controlled like any other file, and shared automatically through the same workflow the team already uses.

---

## Key Features

### Automatic prompt capture via MCP

prompt-audit runs as a local MCP (Model Context Protocol) server. MCP is an open standard created by Anthropic that defines how AI tools communicate with external services — meaning prompt-audit works with any MCP-compatible AI coding tool, not just Claude Code. Configure it once and prompts are captured automatically with zero friction.

### Diff-level function tracking

Changes are tracked at the function level, not the file level. A commit touching three files that modifies five functions produces five audit cards — one per function — each scoped to the exact lines the AI wrote. Hand-written changes in the same commit are left untagged.

### Codebase-aware auditing

Because prior audit history is included as context for every new audit, the pipeline gets smarter over time. New functions are analyzed relative to the patterns and decisions already established in your codebase — not in isolation. Repeated failure modes get flagged more precisely. Convention deviations become visible.

### Audit merge conflicts

When two branches are merged, prompt-audit runs a semantic conflict check alongside git's normal diff resolution. It compares the design philosophies and intent records from both branches for every function touched by both, looking for contradictions that compile cleanly but represent mutually exclusive design decisions.

A cache-aggressively branch and a never-cache-for-compliance branch produce no git conflict. prompt-audit surfaces the contradiction at the intent level, requires a human resolution, and records that resolution as a new prompt event in the permanent history.

### CLI interface

```bash
# Set up prompt-audit in any repo
audit init

# See every prompt event and what it caused
audit log

# Full design history for a specific function
audit show processPayment

# Codebase-wide trust and risk overview
audit status

# Trace which prompts shaped a function
audit why validatePayload
```

---

## Implementation Details

### Tech stack

- **Runtime**: Node.js with TypeScript in ESM mode
- **MCP server**: Built with the official Anthropic MCP TypeScript SDK, communicating over stdio
- **Diff parsing**: Custom hunk-level parser reading raw `git diff` output, no external diff libraries
- **Function detection**: Regex-based boundary detection supporting named functions, arrow functions, class methods, and object method shorthand across TypeScript, JavaScript, TSX, and JSX
- **Audit AI**: Claude Sonnet via the Anthropic API — structured JSON output enforced via system prompt
- **Storage**: Plain JSON files in `.audit/events/` and `.audit/functions/`, committed directly to the repository
- **Git integration**: Post-commit hook installed by `audit init`, pre-push safety gate warns before shipping unverified high-risk functions

### Directory structure

```
.audit/
  events/
    {eventId}.json               ← prompt event record
    {eventId}-changeset.json     ← functions changed by that prompt
  functions/
    {file}_{function}_card.json  ← audit card per prompt per function
    {file}_{function}_record.json ← accumulated function history
```

### The prompt event lifecycle

```
captured → linked → audited
```

A prompt event starts as `pending` when the MCP server captures it. The post-commit hook moves it to `linked` when a commit is associated. The audit orchestrator moves it to `audited` when Claude has analyzed all touched functions and written their cards.

### AI model agnosticism

Because prompt-audit is built on MCP — an open protocol, not a Claude-specific integration — it works with any MCP-compatible AI coding tool. The audit cards are always generated by Claude via the Anthropic API, but the prompt capture layer is tool-agnostic. Teams using Cursor, Cline, Windsurf, or other MCP-compatible tools get the same automatic capture behavior.

### Why not just use git commit messages?

Commit messages describe what the developer chose to write about the change, after the fact, under time pressure. They capture intent inconsistently and are written for humans to read, not machines to query.

prompt-audit captures the raw prompt — the actual instruction given to the AI — before any changes happen, automatically, every time. It then augments that with structured AI analysis of the resulting code. The signal quality is categorically different.

### Why not just ask the AI to explain its code?

A one-shot "explain this function" prompt in a chat window produces a snapshot. It has no memory of prior decisions, no awareness of your codebase's conventions, and no persistence. The explanation lives in a chat session that will be closed.

prompt-audit builds an explanation that is permanently attached to the function, linked to the prompt that caused it, informed by the history of every prior decision in the codebase, and queryable by any developer on the team at any time in the future.

---

## Who This Is For

Any engineering team that uses AI coding tools and has felt the gap between how fast AI generates code and how long it takes to actually trust and understand that code. The problem is sharpest at the moment of code review, at the moment a bug surfaces in AI-generated code, and at the moment a new developer tries to understand a codebase that was built with significant AI assistance.

prompt-audit does not slow down AI-assisted development. It runs in the background, adds seconds to the commit workflow, and produces an asset — the audit history — that compounds in value every time another prompt is captured.

The faster your team uses AI, the more valuable the history becomes.

---

## Current Status

Phases 1, 2, and 3 are complete:

- **Phase 1** — MCP server captures prompts automatically from Claude Code
- **Phase 2** — Post-commit hook links prompts to commits, parses diffs, detects changed functions
- **Phase 3** — Audit pipeline generates structured audit cards via Claude, stores function records, exposes CLI commands

Remaining roadmap: audit merge conflict detection, global npm packaging for cross-repo use, VS Code extension for inline audit card display, and convention learning from accumulated audit history.
