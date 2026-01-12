#!/usr/bin/env bash
set -euo pipefail

# Usage: ./check_prod_assets.sh <username> <password>

API_BASE="https://ubuntu.golden-ghost.ts.net"
USERNAME="${1:-}"
PASSWORD="${2:-}"

if [[ -z "$USERNAME" ]] || [[ -z "$PASSWORD" ]]; then
  echo "Usage: ./check_prod_assets.sh <username> <password>"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is not installed"
  exit 1
fi

echo "Checking backend..."
if ! curl -sf "${API_BASE}/health" >/dev/null; then
  echo "Error: Backend is not running at ${API_BASE}"
  exit 1
fi

TOKEN=$(curl -sf -X POST "${API_BASE}/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
  | jq -r '.access_token // empty')

if [[ -z "$TOKEN" ]]; then
  echo "Error: Failed to authenticate"
  exit 1
fi

echo "Fetching assets..."
ASSET_COUNT=$(curl -sf -X GET "${API_BASE}/assets" \
  -H "Authorization: Bearer $TOKEN" \
  | jq 'length')
echo "Total assets in database: ${ASSET_COUNT}"

echo "Fetching summary..."
curl -sf -X GET "${API_BASE}/summary" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{total_krw: .total_krw, daily_change_krw: .daily_change_krw, asset_count: (.assets | length)}'
