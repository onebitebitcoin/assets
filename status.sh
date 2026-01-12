#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="${ROOT_DIR}/pids"
LOG_DIR="${ROOT_DIR}/logs"

echo "========================================="
echo "Service Status"
echo "========================================="
echo ""

# Check backend
echo "Backend:"
if [[ -f "${PID_DIR}/backend.pid" ]]; then
  BACKEND_PID=$(cat "${PID_DIR}/backend.pid")
  if kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "  ✓ Running (PID ${BACKEND_PID})"
    echo "  Port: 50000"
    echo "  Log: ${LOG_DIR}/backend.log"
  else
    echo "  ✗ Not running (stale PID ${BACKEND_PID})"
  fi
else
  echo "  ✗ Not running (no PID file)"
fi
echo ""

# Check frontend
echo "Frontend:"
if [[ -f "${PID_DIR}/frontend.pid" ]]; then
  FRONTEND_PID=$(cat "${PID_DIR}/frontend.pid")
  if kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    echo "  ✓ Running (PID ${FRONTEND_PID})"
    echo "  Port: 50001"
    echo "  Log: ${LOG_DIR}/frontend.log"
  else
    echo "  ✗ Not running (stale PID ${FRONTEND_PID})"
  fi
else
  echo "  ✗ Not running (no PID file)"
fi
echo ""

# Check tailscale serve
echo "Tailscale Serve:"
if tailscale serve status 2>&1 | grep -q "no serve config"; then
  echo "  ✗ No configuration found"
else
  echo "  ✓ Configuration active:"
  tailscale serve status | sed 's/^/    /'
fi
echo ""

echo "========================================="
