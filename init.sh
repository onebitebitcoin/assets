#!/usr/bin/env bash
set -euo pipefail

# Usage: ./init.sh <username> <password> [assets.json] [--reset]

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

DEFAULT_ASSETS_FILE="assets_from_excel.json"

USERNAME="${1:-}"
PASSWORD="${2:-}"
ASSETS_FILE="${3:-$DEFAULT_ASSETS_FILE}"
RESET_MODE="${4:-}"
API_BASE="${API_BASE:-http://localhost:50000}"

if [[ -z "$USERNAME" ]] || [[ -z "$PASSWORD" ]]; then
  echo "Usage: ./init.sh <username> <password> [assets.json] [--reset]"
  echo ""
  echo "Example:"
  echo "  ./init.sh myusername mypassword assets_from_excel.json --reset"
  exit 1
fi

echo "========================================="
echo "Asset Import Initialization"
echo "========================================="
echo ""

echo "Checking dependencies..."
for cmd in python3 jq curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: $cmd is not installed"
    exit 1
  fi
done
echo "✓ All required commands available"
echo ""

echo "Installing Python dependencies..."
python3 -m pip install -q httpx || {
  echo "Failed to install Python packages"
  exit 1
}
echo "✓ Python packages installed"
echo ""

echo "========================================="
echo "Step 1: Loading asset list"
echo "========================================="
if [[ ! -f "$ASSETS_FILE" ]]; then
  echo "Error: File not found: $ASSETS_FILE"
  exit 1
fi
echo ""

echo "========================================="
echo "Step 2: Mapping assets and calculating quantities"
echo "========================================="
python3 map_assets.py "$ASSETS_FILE" assets_api.json || {
  echo "Failed to map assets"
  exit 1
}
echo ""

echo "========================================="
echo "Step 3: Authenticating with backend"
echo "========================================="
if ! curl -sf "${API_BASE}/health" >/dev/null; then
  echo "Error: Backend is not running at ${API_BASE}"
  echo "Please start the backend first with: ./deploy.sh"
  exit 1
fi
echo "✓ Backend is running"
echo ""

echo "Authenticating user: $USERNAME"
TOKEN=$(curl -sf -X POST "${API_BASE}/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" 2>/dev/null \
  | jq -r '.access_token // empty' 2>/dev/null || \
  curl -sf -X POST "${API_BASE}/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
  | jq -r '.access_token // empty')

if [[ -z "$TOKEN" ]]; then
  echo "Error: Failed to authenticate"
  echo "Please check your username and password"
  exit 1
fi
echo "✓ Authenticated successfully"
echo ""

if [[ "$RESET_MODE" == "--reset" ]]; then
  echo "========================================="
  echo "Step 3.5: Clearing existing assets"
  echo "========================================="
  EXISTING_ASSETS=$(curl -sf -X GET "${API_BASE}/assets" \
    -H "Authorization: Bearer $TOKEN" \
    | jq -c '.[]')
  if [[ -n "$EXISTING_ASSETS" ]]; then
    while read -r asset; do
      ASSET_ID=$(echo "$asset" | jq -r '.id')
      ASSET_NAME=$(echo "$asset" | jq -r '.name')
      echo -n "  Deleting: ${ASSET_NAME}... "
      RESPONSE=$(curl -sf -X DELETE "${API_BASE}/assets/${ASSET_ID}" \
        -H "Authorization: Bearer $TOKEN" 2>&1) || {
        echo "FAILED"
        echo "    Error: $RESPONSE"
        continue
      }
      echo "OK"
      sleep 0.1
    done < <(echo "$EXISTING_ASSETS")
  else
    echo "  No existing assets found."
  fi
  echo ""
fi

echo "========================================="
echo "Step 4: Creating assets in database"
echo "========================================="
TOTAL_COUNT=$(jq 'length' assets_api.json)
echo "Importing ${TOTAL_COUNT} assets..."
echo ""

SUCCESS_COUNT=0
FAILED_COUNT=0

while read -r asset; do
  ASSET_NAME=$(echo "$asset" | jq -r '.name')
  echo -n "  Creating: ${ASSET_NAME}... "

  RESPONSE=$(curl -sf -X POST "${API_BASE}/assets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "$asset" 2>&1) || {
    echo "FAILED"
    echo "    Error: $RESPONSE"
    FAILED_COUNT=$((FAILED_COUNT + 1))
    continue
  }

  echo "OK"
  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  sleep 0.2
done < <(jq -c '.[]' assets_api.json)

echo ""
echo "========================================="
echo "Import Complete!"
echo "========================================="
echo "  ✓ Successfully imported: ${SUCCESS_COUNT} assets"
if [[ ${FAILED_COUNT} -gt 0 ]]; then
  echo "  ✗ Failed: ${FAILED_COUNT} assets"
fi
echo ""

echo "Verifying imported assets..."
ASSET_COUNT=$(curl -sf -X GET "${API_BASE}/assets" \
  -H "Authorization: Bearer $TOKEN" \
  | jq 'length')
echo "Total assets in database: ${ASSET_COUNT}"
echo ""

echo "Getting portfolio summary..."
curl -sf -X GET "${API_BASE}/summary" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{total_krw: .total_krw, daily_change_krw: .daily_change_krw, asset_count: (.assets | length)}'
echo ""

echo "========================================="
echo "Done! You can now use the app."
echo "========================================="
echo ""
echo "Next steps:"
echo "  - View assets: curl ${API_BASE}/assets -H \"Authorization: Bearer $TOKEN\" | jq"
echo "  - Refresh prices: curl -X POST ${API_BASE}/refresh -H \"Authorization: Bearer $TOKEN\""
echo "  - View summary: curl ${API_BASE}/summary -H \"Authorization: Bearer $TOKEN\" | jq"
echo ""
