#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="${ROOT_DIR}/pids"

echo "Stopping services..."

stopped_any=false

if [[ -f "${PID_DIR}/backend.pid" ]]; then
  BACKEND_PID=$(cat "${PID_DIR}/backend.pid")
  if kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "Stopping backend (PID ${BACKEND_PID})..."
    kill "${BACKEND_PID}" 2>/dev/null || true
    stopped_any=true
  else
    echo "Backend (PID ${BACKEND_PID}) is not running"
  fi
  rm -f "${PID_DIR}/backend.pid"
else
  echo "No backend PID file found"
fi

if [[ -f "${PID_DIR}/frontend.pid" ]]; then
  FRONTEND_PID=$(cat "${PID_DIR}/frontend.pid")
  if kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    echo "Stopping frontend (PID ${FRONTEND_PID})..."
    kill "${FRONTEND_PID}" 2>/dev/null || true
    stopped_any=true
  else
    echo "Frontend (PID ${FRONTEND_PID}) is not running"
  fi
  rm -f "${PID_DIR}/frontend.pid"
else
  echo "No frontend PID file found"
fi

if [[ "${stopped_any}" == "true" ]]; then
  echo ""
  echo "Waiting for processes to terminate..."
  sleep 2
  echo "Services stopped."
else
  echo ""
  echo "No services were running."
fi

echo ""
echo "Note: Tailscale serve configuration is still active."
echo "To remove it, run: tailscale serve reset"
