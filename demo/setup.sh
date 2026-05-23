#!/usr/bin/env bash
#
# git-audit demo setup
# Builds a fresh demo repo at /tmp/git-audit-demo with two pre-built
# branches (feature/performance-mode, feature/strict-validation) whose
# audit cards directly contradict each other so `audit merge` can
# surface the design-level conflict live in front of judges.
#
set -euo pipefail

DEMO_DIR=/tmp/git-audit-demo
GIT_AUDIT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_SERVER_PATH="$GIT_AUDIT_ROOT/src/mcp/server.ts"

cyan()  { printf '\033[36m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }

# ── Step 1 — Require ANTHROPIC_API_KEY ────────────────────────────────────────
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  red "ERROR: ANTHROPIC_API_KEY is not set."
  red "Export it before running setup:  export ANTHROPIC_API_KEY=sk-ant-..."
  exit 1
fi

# Sanity: audit CLI on PATH
if ! command -v audit >/dev/null 2>&1; then
  red "ERROR: the 'audit' CLI is not on PATH. Run 'npm run build && npm link' in $GIT_AUDIT_ROOT first."
  exit 1
fi

cyan "→ Building fresh demo repo at $DEMO_DIR"

# ── Step 2 — Fresh demo repo ──────────────────────────────────────────────────
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR/src/payments"
cd "$DEMO_DIR"

# ── Step 3 — git init + initial empty commit ──────────────────────────────────
git init -q
git config user.email "demo@git-audit.local"
git config user.name  "git-audit demo"
git commit -q --allow-empty -m "initial commit"
DEFAULT_BRANCH="$(git symbolic-ref --short HEAD)"
cyan "→ Default branch detected: $DEFAULT_BRANCH"

# ── Step 4 — audit init (installs hooks, writes mcp.json) ─────────────────────
audit init

# ── Step 5 — Register MCP server with Claude Code ─────────────────────────────
TSX_PATH="$(command -v tsx || echo /home/kylenngu/.npm-global/bin/tsx)"
if command -v claude >/dev/null 2>&1; then
  claude mcp remove git-audit >/dev/null 2>&1 || true
  if claude mcp add --help 2>&1 | grep -qE -- '(--env|^\s*-e,)'; then
    if claude mcp add -e "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" git-audit -- "$TSX_PATH" "$MCP_SERVER_PATH" >/dev/null 2>&1; then
      green "✓ Claude Code MCP server registered (with --env)"
    else
      claude mcp add git-audit -- "$TSX_PATH" "$MCP_SERVER_PATH" >/dev/null 2>&1 || true
      green "✓ Claude Code MCP server registered (without --env)"
    fi
  else
    claude mcp add git-audit -- "$TSX_PATH" "$MCP_SERVER_PATH" >/dev/null 2>&1 || true
    green "✓ Claude Code MCP server registered"
  fi
else
  red "Note: 'claude' CLI not found — skipping MCP registration. mcp.json in the repo is still configured."
fi

# ── Step 6 — Realistic starting file with no error handling ───────────────────
cat > src/payments/handler.ts <<'EOF'
// payment handler — initial version, no error handling yet
const ALLOWED_METHODS = ["card", "bank", "wallet"];

export function validatePaymentMethod(method: string): boolean {
  return ALLOWED_METHODS.includes(method);
}

export function processPayment(
  amount: number,
  currency: string,
  customerId: string
): void {
  console.log(`Processing payment: ${amount} ${currency} for ${customerId}`);
  // TODO: call payment gateway
}
EOF

# ── Step 7 — Baseline commit (no captured prompt) ─────────────────────────────
git add -A
git commit -q -m "initial payment handler" || true
green "✓ Baseline committed on $DEFAULT_BRANCH"

# ─────────────────────────────────────────────────────────────────────────────
# Pre-built conflict branches
#
# Each branch ships a different version of processPayment plus a fully
# fabricated audit trail (prompt event + audit card + function record).
# Decisions are crafted so the conflict analyzer picks up the direct
# "always" vs. "never" opposition in src/payments/handler.ts.
# ─────────────────────────────────────────────────────────────────────────────

write_event() {
  # write_event <path> <id> <prompt>
  local out_path="$1" id="$2" prompt="$3"
  cat > "$out_path" <<EOF
{
  "id": "$id",
  "timestamp": "2026-05-20T10:00:00.000Z",
  "rawPrompt": "$prompt",
  "status": "audited",
  "linkedCommit": "PLACEHOLDER_COMMIT",
  "aiTool": "claude-code"
}
EOF
}

# ── feature/performance-mode ──────────────────────────────────────────────────
cyan "→ Building branch feature/performance-mode"
git checkout -q -b feature/performance-mode

cat > src/payments/handler.ts <<'EOF'
// payment handler — performance-mode variant
// Validation results are cached for 5 minutes to reduce external API calls.
const ALLOWED_METHODS = ["card", "bank", "wallet"];

const validationCache = new Map<string, { result: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function validatePaymentMethod(method: string): boolean {
  const cached = validationCache.get(method);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  const result = ALLOWED_METHODS.includes(method);
  validationCache.set(method, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

export function processPayment(
  amount: number,
  currency: string,
  customerId: string
): void {
  // always cache payment validation results for 5 minutes to reduce API calls
  if (!validatePaymentMethod("card")) {
    throw new Error("invalid payment method");
  }
  console.log(`Processing payment: ${amount} ${currency} for ${customerId}`);
}
EOF

git add src/payments/handler.ts
git commit -q -m "cache payment validation for 5 minutes" || true
PERF_HASH="$(git rev-parse HEAD)"

PERF_EVENT_ID="perf-demo-0001"
PERF_TIMESTAMP_RAW="2026-05-20T10:00:00.000Z"
PERF_TIMESTAMP_SAFE="2026-05-20T10-00-00-000Z"
PERF_CARD_FILE=".audit/functions/src_payments_handler_ts_processPayment_${PERF_TIMESTAMP_SAFE}_card.json"
PERF_RECORD_FILE=".audit/functions/src_payments_handler_ts_processPayment_record.json"
PERF_CARD_ABS="$DEMO_DIR/$PERF_CARD_FILE"

write_event ".audit/events/${PERF_EVENT_ID}.json" \
  "$PERF_EVENT_ID" \
  "optimize payment handler, cache validation results to reduce external API calls"
# patch linkedCommit
sed -i "s|PLACEHOLDER_COMMIT|$PERF_HASH|" ".audit/events/${PERF_EVENT_ID}.json"

cat > "$PERF_CARD_FILE" <<EOF
{
  "promptEventId": "$PERF_EVENT_ID",
  "commitHash": "$PERF_HASH",
  "file": "src/payments/handler.ts",
  "functionName": "processPayment",
  "linesChanged": { "start": 18, "end": 27 },
  "what": "processPayment now always uses cached payment-method validation results for 5 minutes before falling back to a fresh check, reducing redundant calls to the upstream validation API.",
  "decisions": [
    "Chose to always cache validation results for 5 minutes over re-checking on every call — reduces redundant API calls to the payment gateway and lowers p99 latency",
    "Chose an in-memory Map over a Redis cache because the demo handler is single-process and Redis would add deployment complexity"
  ],
  "risks": [
    { "message": "stale validation if a payment method is revoked mid-cache window", "severity": "medium" }
  ],
  "testssuggested": [
    "Given a cached allowed method when 5 minutes have passed then validatePaymentMethod re-queries the source list",
    "Given two rapid calls with the same method when within the TTL then ALLOWED_METHODS is checked at most once"
  ],
  "trustStatus": "unverified",
  "createdAt": "$PERF_TIMESTAMP_RAW"
}
EOF

cat > "$PERF_RECORD_FILE" <<EOF
{
  "functionName": "processPayment",
  "file": "src/payments/handler.ts",
  "createdByPromptId": "$PERF_EVENT_ID",
  "lastModifiedByPromptId": "$PERF_EVENT_ID",
  "auditHistory": [
    {
      "promptEventId": "$PERF_EVENT_ID",
      "commitHash": "$PERF_HASH",
      "cardRef": "$PERF_CARD_ABS"
    }
  ],
  "openRisks": [
    {
      "message": "stale validation if a payment method is revoked mid-cache window",
      "severity": "medium",
      "introducedByPromptId": "$PERF_EVENT_ID"
    }
  ],
  "trustScore": 90
}
EOF

git add .audit
git commit -q -m "audit: cache validation for performance" || true
green "✓ feature/performance-mode ready"

git checkout -q "$DEFAULT_BRANCH"

# ── feature/strict-validation ─────────────────────────────────────────────────
cyan "→ Building branch feature/strict-validation"
git checkout -q -b feature/strict-validation

cat > src/payments/handler.ts <<'EOF'
// payment handler — strict-validation variant
// Compliance requires fresh checks on every call; results are never cached.
const ALLOWED_METHODS = ["card", "bank", "wallet"];

export function validatePaymentMethod(method: string): boolean {
  // always call validation fresh — compliance requires no caching
  return ALLOWED_METHODS.includes(method);
}

export function processPayment(
  amount: number,
  currency: string,
  customerId: string
): void {
  // always validate fresh — never use cached results for compliance reasons
  if (!validatePaymentMethod("card")) {
    throw new Error("payment method not allowed");
  }
  console.log(`Processing payment: ${amount} ${currency} for ${customerId}`);
}
EOF

git add src/payments/handler.ts
git commit -q -m "always validate fresh for compliance" || true
STRICT_HASH="$(git rev-parse HEAD)"

STRICT_EVENT_ID="strict-demo-0001"
STRICT_TIMESTAMP_RAW="2026-05-20T10:05:00.000Z"
STRICT_TIMESTAMP_SAFE="2026-05-20T10-05-00-000Z"
STRICT_CARD_FILE=".audit/functions/src_payments_handler_ts_processPayment_${STRICT_TIMESTAMP_SAFE}_card.json"
STRICT_RECORD_FILE=".audit/functions/src_payments_handler_ts_processPayment_record.json"
STRICT_CARD_ABS="$DEMO_DIR/$STRICT_CARD_FILE"

write_event ".audit/events/${STRICT_EVENT_ID}.json" \
  "$STRICT_EVENT_ID" \
  "make payment validation always fresh, compliance requires no caching"
sed -i "s|PLACEHOLDER_COMMIT|$STRICT_HASH|" ".audit/events/${STRICT_EVENT_ID}.json"

cat > "$STRICT_CARD_FILE" <<EOF
{
  "promptEventId": "$STRICT_EVENT_ID",
  "commitHash": "$STRICT_HASH",
  "file": "src/payments/handler.ts",
  "functionName": "processPayment",
  "linesChanged": { "start": 11, "end": 22 },
  "what": "processPayment now always re-runs validation against the source list on every call. No cached results are consulted because compliance requires evidence that every authorized payment was freshly validated.",
  "decisions": [
    "Chose to never cache validation results — compliance requires fresh checks on every call, and any caching would prevent the audit trail from showing per-transaction validation",
    "Chose to always throw a descriptive error on invalid methods over returning a boolean so callers cannot silently proceed with an unauthorized payment"
  ],
  "risks": [
    { "message": "higher upstream API load under traffic spikes", "severity": "medium" }
  ],
  "testssuggested": [
    "Given two back-to-back calls with the same method when called within milliseconds then ALLOWED_METHODS is checked both times",
    "Given a disallowed method when processPayment is invoked then it throws before logging"
  ],
  "trustStatus": "unverified",
  "createdAt": "$STRICT_TIMESTAMP_RAW"
}
EOF

cat > "$STRICT_RECORD_FILE" <<EOF
{
  "functionName": "processPayment",
  "file": "src/payments/handler.ts",
  "createdByPromptId": "$STRICT_EVENT_ID",
  "lastModifiedByPromptId": "$STRICT_EVENT_ID",
  "auditHistory": [
    {
      "promptEventId": "$STRICT_EVENT_ID",
      "commitHash": "$STRICT_HASH",
      "cardRef": "$STRICT_CARD_ABS"
    }
  ],
  "openRisks": [
    {
      "message": "higher upstream API load under traffic spikes",
      "severity": "medium",
      "introducedByPromptId": "$STRICT_EVENT_ID"
    }
  ],
  "trustScore": 90
}
EOF

git add .audit
git commit -q -m "audit: strict validation for compliance" || true
green "✓ feature/strict-validation ready"

git checkout -q "$DEFAULT_BRANCH"

# ── Step 8 — Summary ──────────────────────────────────────────────────────────
cat <<EOF

$(green "Demo setup complete.")

  Repo:               $DEMO_DIR
  Default branch:     $DEFAULT_BRANCH
  Branches ready:     feature/performance-mode, feature/strict-validation

  Next steps:
    1.  cd $DEMO_DIR
    2.  claude                      # confirm: "what MCP tools do you have?"
    3.  Send the demo prompt (see demo/DEMO_SCRIPT.md, Step 2)
    4.  git add -A && git commit -m "add error handling"
    5.  audit status
    6.  audit show processPayment
    7.  audit log
    8.  audit merge feature/strict-validation feature/performance-mode

EOF
