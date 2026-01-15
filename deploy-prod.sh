#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

git add -A
git commit -m "deploy $(date -u +%F_%H%M%S)" || true
git push origin main

ssh -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes administrator@100.124.127.16 "cd /opt/floridaeco && ./deploy.sh"
