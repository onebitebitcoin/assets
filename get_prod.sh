#!/usr/bin/env bash
set -euo pipefail

# Usage: ./get_prod.sh <username> <password>

API_BASE="${API_BASE:-https://ubuntu.golden-ghost.ts.net/api}"
USERNAME="${1:-}"
PASSWORD="${2:-}"

if [[ -z "$USERNAME" ]] || [[ -z "$PASSWORD" ]]; then
  echo "Usage: ./get_prod.sh <username> <password>"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is not installed"
  exit 1
fi

echo "Checking backend..."
if ! curl -sf "${API_BASE}/health" >/dev/null; then
  echo "Warn: ${API_BASE}/health unreachable. Trying localhost..." >&2
  if curl -sf "http://127.0.0.1:50000/health" >/dev/null; then
    API_BASE="http://127.0.0.1:50000"
  else
    echo "Error: Backend is not running at ${API_BASE}"
    exit 1
  fi
fi

TOKEN=$(curl -sf -X POST "${API_BASE}/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
  | jq -r '.access_token // empty')

if [[ -z "$TOKEN" ]]; then
  echo "Error: Failed to authenticate"
  exit 1
fi

echo "Asset list:"
curl -sf -X GET "${API_BASE}/assets" \
  -H "Authorization: Bearer $TOKEN" \
  | jq

echo ""
echo "Summary:"
curl -sf -X GET "${API_BASE}/summary" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{total_krw: .total_krw, daily_change_krw: .daily_change_krw, asset_count: (.assets | length)}'
