#!/usr/bin/env bash
set -euo pipefail

# Usage: ./init_prod.sh <username> <password> [assets.json] [--reset]

API_BASE="https://ubuntu.golden-ghost.ts.net" exec "$(dirname "$0")/init.sh" "$@"
