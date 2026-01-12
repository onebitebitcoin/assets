#!/usr/bin/env bash
set -euo pipefail

# Usage: ./init.sh <username> <password> <excel1.xlsx> <excel2.xlsx>

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

USERNAME="${1:-}"
PASSWORD="${2:-}"
EXCEL1="${3:-}"
EXCEL2="${4:-}"
API_BASE="http://localhost:50000"

if [[ -z "$USERNAME" ]] || [[ -z "$PASSWORD" ]]; then
  echo "Usage: ./init.sh <username> <password> <excel1.xlsx> <excel2.xlsx>"
  echo ""
  echo "Example:"
  echo "  ./init.sh myusername mypassword \\"
  echo "    \"/path/to/excel1.xlsx\" \\"
  echo "    \"/path/to/excel2.xlsx\""
  exit 1
fi

echo "========================================="
echo "Asset Import Initialization"
echo "========================================="
echo ""

# Check dependencies
echo "Checking dependencies..."
for cmd in python3 jq curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: $cmd is not installed"
    exit 1
  fi
done
echo "✓ All required commands available"
echo ""

# Install Python dependencies
echo "Installing Python dependencies..."
pip3 install -q openpyxl httpx || {
  echo "Failed to install Python packages"
  exit 1
}
echo "✓ Python packages installed"
echo ""

# Parse Excel files
echo "========================================="
echo "Step 1: Parsing Excel files"
echo "========================================="
if [[ ! -f "$EXCEL1" ]]; then
  echo "Error: File not found: $EXCEL1"
  exit 1
fi
if [[ -n "$EXCEL2" ]] && [[ ! -f "$EXCEL2" ]]; then
  echo "Error: File not found: $EXCEL2"
  exit 1
fi

if [[ -n "$EXCEL2" ]]; then
  python3 parse_assets.py "$EXCEL1" "$EXCEL2" || {
    echo "Failed to parse Excel files"
    exit 1
  }
else
  python3 parse_assets.py "$EXCEL1" || {
    echo "Failed to parse Excel file"
    exit 1
  }
fi
echo ""

# Map assets to API format
echo "========================================="
echo "Step 2: Mapping assets and calculating quantities"
echo "========================================="
python3 map_assets.py assets_raw.json assets_api.json || {
  echo "Failed to map assets"
  exit 1
}
echo ""

# Check backend is running
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

# Register or login
echo "Authenticating user: $USERNAME"
TOKEN=$(curl -sf -X POST "${API_BASE}/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" 2>/dev/null \
  | jq -r '.access_token' 2>/dev/null || \
  curl -sf -X POST "${API_BASE}/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
  | jq -r '.access_token')

if [[ -z "$TOKEN" ]] || [[ "$TOKEN" == "null" ]]; then
  echo "Error: Failed to authenticate"
  echo "Please check your username and password"
  exit 1
fi
echo "✓ Authenticated successfully"
echo ""

# Create assets
echo "========================================="
echo "Step 4: Creating assets in database"
echo "========================================="
TOTAL_COUNT=$(jq 'length' assets_api.json)
echo "Importing ${TOTAL_COUNT} assets..."
echo ""

SUCCESS_COUNT=0
FAILED_COUNT=0

cat assets_api.json | jq -c '.[]' | while read -r asset; do
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
done

echo ""
echo "========================================="
echo "Import Complete!"
echo "========================================="
echo "  ✓ Successfully imported: ${SUCCESS_COUNT} assets"
if [[ ${FAILED_COUNT} -gt 0 ]]; then
  echo "  ✗ Failed: ${FAILED_COUNT} assets"
fi
echo ""

# Verify
echo "Verifying imported assets..."
ASSET_COUNT=$(curl -sf -X GET "${API_BASE}/assets" \
  -H "Authorization: Bearer $TOKEN" \
  | jq 'length')
echo "Total assets in database: ${ASSET_COUNT}"
echo ""

# Show summary
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
