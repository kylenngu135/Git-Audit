#!/usr/bin/env bash
#
# git-audit demo reset
# Tears down the demo repo and re-runs setup.sh from scratch so the
# walkthrough can be replayed reliably between judges.
#
set -euo pipefail

DEMO_DIR=/tmp/git-audit-demo
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Step 1 — Delete the demo repo
rm -rf "$DEMO_DIR"

# Step 2 — Re-run setup
bash "$HERE/setup.sh"

# Step 3 — Confirm
printf '\033[32m%s\033[0m\n' "Demo reset complete"
