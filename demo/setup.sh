#!/bin/bash

set -e

echo "Setting up git-audit demo..."

DEMO_DIR=/tmp/git-audit-demo
# Resolve git-audit root before any cd so dirname "$0" stays valid
GIT_AUDIT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Check prerequisites
if ! command -v audit &> /dev/null; then
  echo "ERROR: audit command not found."
  echo "Run: cd /path/to/git-audit && npm run build && npm link"
  exit 1
fi

if ! command -v tsx &> /dev/null; then
  echo "ERROR: tsx not found. Run: npm install -g tsx"
  exit 1
fi

if ! command -v claude &> /dev/null; then
  echo "ERROR: Claude Code CLI not found. Install Claude Code first."
  exit 1
fi

# Clean up any previous demo
rm -rf "$DEMO_DIR"
echo "Cleaned up previous demo."

# Create fresh demo repo
mkdir -p "$DEMO_DIR"
cd "$DEMO_DIR"
git init
git config user.email "demo@git-audit.dev"
git config user.name "git-audit Demo"

# Create initial file BEFORE audit init
# so the first commit has no audit on it
mkdir -p src/payments
cat > src/payments/handler.ts << 'EOF'
// Payment handler — initial version (no error handling yet)

export function processPayment(
  amount: number,
  currency: string,
  customerId: string
) {
  console.log(`Processing payment: ${amount} ${currency} for ${customerId}`)
  return { success: true, transactionId: Math.random().toString(36) }
}

export function validatePaymentMethod(method: string) {
  const allowed = ["credit_card", "debit_card", "paypal"]
  return allowed.includes(method)
}
EOF

git add -A
git commit -m "initial payment handler — no error handling yet"
echo "Created initial payment handler."

# Now run audit init to set everything up
audit init

# Commit the .audit/ skeleton to master so it persists across branch checkouts
# Without this, git removes the untracked .audit/ dir when switching branches
git add -A
git commit -m "audit: initialize git-audit"
echo "audit init complete."

# Register MCP server with Claude Code
TSX_PATH=$(which tsx)
MCP_SERVER_PATH="$GIT_AUDIT_ROOT/src/mcp/server.ts"

claude mcp add git-audit "$TSX_PATH" "$MCP_SERVER_PATH" 2>/dev/null || \
  echo "MCP server already registered or could not auto-register."

echo ""
echo "Creating pre-built merge conflict branches..."

# Branch A — performance focused
git checkout -b feature/performance-caching

cat > src/payments/handler.ts << 'EOF'
// Payment handler — performance optimized
// Caches validation results to reduce external API calls

const validationCache = new Map<string, boolean>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function processPayment(
  amount: number,
  currency: string,
  customerId: string
) {
  if (!amount || amount <= 0) throw new Error("Invalid amount")
  // Use cached validation for repeat customers
  const cacheKey = `${customerId}-${currency}`
  if (!validationCache.has(cacheKey)) {
    validationCache.set(cacheKey, true)
  }
  console.log(`Processing payment: ${amount} ${currency} for ${customerId}`)
  return { success: true, transactionId: Math.random().toString(36) }
}

export function validatePaymentMethod(method: string) {
  const allowed = ["credit_card", "debit_card", "paypal"]
  return allowed.includes(method)
}
EOF

# Write a fake audit event for this branch
BRANCH_A_EVENT_ID="demo-branch-a-$(date +%s)"
mkdir -p .audit/events
cat > ".audit/events/${BRANCH_A_EVENT_ID}.json" << EOF
{
  "id": "${BRANCH_A_EVENT_ID}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "rawPrompt": "optimize payment handler for high traffic — cache validation results to reduce redundant external API calls and improve response time",
  "status": "audited",
  "aiTool": "claude-code",
  "linkedCommit": "branch-a-demo"
}
EOF

# Write fake audit card for processPayment on this branch
# cardRef must be an absolute path — the conflict analyzer resolves it to repo-relative via path.relative()
mkdir -p .audit/functions
cat > ".audit/functions/src_payments_handler_ts_processPayment_record.json" << EOF
{
  "functionName": "processPayment",
  "file": "src/payments/handler.ts",
  "createdByPromptId": "${BRANCH_A_EVENT_ID}",
  "lastModifiedByPromptId": "${BRANCH_A_EVENT_ID}",
  "auditHistory": [
    {
      "promptEventId": "${BRANCH_A_EVENT_ID}",
      "commitHash": "branch-a-demo",
      "cardRef": "${DEMO_DIR}/.audit/functions/src_payments_handler_ts_processPayment_branch_a_card.json"
    }
  ],
  "openRisks": [],
  "trustScore": 80
}
EOF

# "always" in Branch A decisions + "never" in Branch B decisions triggers the
# direct-opposition conflict detector in conflictAnalyzer.ts (["always","never"] pair)
cat > ".audit/functions/src_payments_handler_ts_processPayment_branch_a_card.json" << EOF
{
  "id": "branch-a-card",
  "promptEventId": "${BRANCH_A_EVENT_ID}",
  "commitHash": "branch-a-demo",
  "file": "src/payments/handler.ts",
  "functionName": "processPayment",
  "linesChanged": { "start": 8, "end": 18 },
  "what": "Adds in-memory caching of payment validation results with a 5-minute TTL to avoid redundant external API calls for repeat customers.",
  "decisions": [
    "Chose to always cache validation results in an in-memory Map over a Redis cache — simpler setup, acceptable for single-instance deployment",
    "Chose 5-minute TTL to balance freshness with performance — matches average session duration",
    "Chose to cache per customer+currency key to allow different currencies for the same customer"
  ],
  "risks": [],
  "testssuggested": [
    "Given a repeat customer when processPayment called twice then second call uses cache",
    "Given cache TTL expired when processPayment called then cache is refreshed"
  ],
  "trustStatus": "unverified",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
}
EOF

git add -A
git commit -m "optimize payment handler with validation caching"
echo "Created feature/performance-caching branch."

# Switch back to main/master
git checkout -

# Branch B — compliance focused
git checkout -b feature/compliance-strict

cat > src/payments/handler.ts << 'EOF'
// Payment handler — compliance hardened
// PCI-DSS requires fresh validation on every transaction
// Never cache payment validation results

export function processPayment(
  amount: number,
  currency: string,
  customerId: string
) {
  if (!amount || amount <= 0) throw new Error("Invalid amount")
  if (!currency) throw new Error("Currency required")
  if (!customerId) throw new Error("Customer ID required")
  // Always validate fresh — compliance requirement
  // Caching validation results is explicitly prohibited
  console.log(`Processing payment: ${amount} ${currency} for ${customerId}`)
  return { success: true, transactionId: Math.random().toString(36) }
}

export function validatePaymentMethod(method: string) {
  const allowed = ["credit_card", "debit_card", "paypal"]
  if (!method) throw new Error("Payment method required")
  return allowed.includes(method)
}
EOF

# Write fake audit event for this branch
BRANCH_B_EVENT_ID="demo-branch-b-$(date +%s)"
cat > ".audit/events/${BRANCH_B_EVENT_ID}.json" << EOF
{
  "id": "${BRANCH_B_EVENT_ID}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "rawPrompt": "harden payment handler for PCI-DSS compliance — always validate fresh on every transaction, never cache payment validation results, add strict input validation",
  "status": "audited",
  "aiTool": "claude-code",
  "linkedCommit": "branch-b-demo"
}
EOF

cat > ".audit/functions/src_payments_handler_ts_processPayment_record.json" << EOF
{
  "functionName": "processPayment",
  "file": "src/payments/handler.ts",
  "createdByPromptId": "${BRANCH_B_EVENT_ID}",
  "lastModifiedByPromptId": "${BRANCH_B_EVENT_ID}",
  "auditHistory": [
    {
      "promptEventId": "${BRANCH_B_EVENT_ID}",
      "commitHash": "branch-b-demo",
      "cardRef": "${DEMO_DIR}/.audit/functions/src_payments_handler_ts_processPayment_branch_b_card.json"
    }
  ],
  "openRisks": [],
  "trustScore": 85
}
EOF

cat > ".audit/functions/src_payments_handler_ts_processPayment_branch_b_card.json" << EOF
{
  "id": "branch-b-card",
  "promptEventId": "${BRANCH_B_EVENT_ID}",
  "commitHash": "branch-b-demo",
  "file": "src/payments/handler.ts",
  "functionName": "processPayment",
  "linesChanged": { "start": 8, "end": 20 },
  "what": "Adds strict input validation and enforces fresh validation on every transaction to meet PCI-DSS compliance requirements. Caching is explicitly prohibited.",
  "decisions": [
    "Chose to never cache validation results — PCI-DSS compliance explicitly prohibits caching payment validation results",
    "Chose to throw typed errors for missing inputs rather than returning null — callers must handle invalid state explicitly",
    "Chose to validate all three inputs at entry point before any logic runs — defense in depth"
  ],
  "risks": [],
  "testssuggested": [
    "Given missing currency when processPayment called then throws with clear message",
    "Given missing customerId when processPayment called then throws with clear message",
    "Verify no caching occurs between consecutive calls for same customer"
  ],
  "trustStatus": "unverified",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
}
EOF

git add -A
git commit -m "harden payment handler for PCI-DSS compliance"
echo "Created feature/compliance-strict branch."

# Switch back to main/master
git checkout -

echo ""
echo "────────────────────────────────────────────────────"
echo "Demo setup complete!"
echo ""
echo "Demo repo: $DEMO_DIR"
echo "Branches ready:"
git branch
echo ""
echo "Next steps:"
echo "  cd $DEMO_DIR"
echo "  claude   ← start Claude Code for the live demo"
echo "────────────────────────────────────────────────────"
