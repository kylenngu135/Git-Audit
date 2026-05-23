#!/bin/bash
echo "Resetting demo..."
rm -rf /tmp/git-audit-demo
bash "$(dirname "$0")/setup.sh"
echo "Demo reset complete."
