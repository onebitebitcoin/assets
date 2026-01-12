#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_PORT=50001
BACKEND_PORT=50000
EXTERNAL_PORT=443
RESET_SERVE=false

for arg in "$@"; do
  case "${arg}" in
    --reset)
      RESET_SERVE=true
      ;;
    *)
      echo "Unknown option: ${arg}" >&2
      echo "Usage: ./deploy.sh [--reset]" >&2
      exit 1
      ;;
  esac
done

require_cmd() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "${cmd} is not installed or not in PATH." >&2
    exit 1
  fi
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | awk '{print $9}' | grep -q ":${port}$"
    return $?
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":${port}$"
    return $?
  fi
  echo "Neither lsof nor ss is available to check ports." >&2
  exit 1
}

require_cmd tailscale
require_cmd python3
require_cmd npm

cd "${ROOT_DIR}"

if port_in_use "${FRONTEND_PORT}"; then
  echo "Port ${FRONTEND_PORT} is already in use. Stop the service or choose a different port." >&2
  exit 1
fi
if port_in_use "${BACKEND_PORT}"; then
  echo "Port ${BACKEND_PORT} is already in use. Stop the service or choose a different port." >&2
  exit 1
fi

STATUS_OUTPUT="$(tailscale serve status 2>/dev/null || true)"
if [[ "${RESET_SERVE}" == "true" ]]; then
  echo "Resetting tailscale serve config..."
  tailscale serve reset || true
else
  if [[ -n "${STATUS_OUTPUT}" ]] && ! echo "${STATUS_OUTPUT}" | grep -qi "no serve config"; then
    echo "Existing tailscale serve config detected. Run with --reset to replace it." >&2
    exit 1
  fi
fi

echo "Setting up Python venv and backend deps..."
if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
fi
VENV_PIP=".venv/bin/pip"
VENV_UVICORN=".venv/bin/uvicorn"
if [[ ! -x "${VENV_PIP}" ]]; then
  echo "Missing .venv/bin/pip. Recreate the venv." >&2
  exit 1
fi
"${VENV_PIP}" install -r backend/requirements.txt

echo "Installing frontend deps..."
npm --prefix frontend install

echo "Starting backend on ${BACKEND_PORT}..."
"${VENV_UVICORN}" backend.main:app --host 127.0.0.1 --port "${BACKEND_PORT}" &
BACKEND_PID=$!

echo "Starting frontend on ${FRONTEND_PORT}..."
npm --prefix frontend run dev -- --host 127.0.0.1 --port "${FRONTEND_PORT}" &
FRONTEND_PID=$!

trap 'kill ${BACKEND_PID} ${FRONTEND_PID} 2>/dev/null || true' EXIT

echo "Mapping frontend to / on https port ${EXTERNAL_PORT} -> ${FRONTEND_PORT}"
tailscale serve --https="${EXTERNAL_PORT}" --set-path=/ "http://127.0.0.1:${FRONTEND_PORT}"

echo "Mapping backend to /api on https port ${EXTERNAL_PORT} -> ${BACKEND_PORT}"
tailscale serve --https="${EXTERNAL_PORT}" --set-path=/api "http://127.0.0.1:${BACKEND_PORT}"

echo "Current tailscale serve status:"
tailscale serve status

echo "Services are running. Press Ctrl+C to stop."
wait
