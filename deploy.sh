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

kill_port() {
  local port="$1"
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -ti tcp:"${port}" 2>/dev/null || true)
  elif command -v ss >/dev/null 2>&1; then
    pids=$(ss -ltnp 2>/dev/null | awk -v port=":${port}" '$0 ~ port {print $NF}' | sed -E 's/.*pid=([0-9]+).*/\\1/' | sort -u)
  fi
  if [[ -n "${pids}" ]]; then
    echo "Stopping process on port ${port}: ${pids}"
    kill ${pids} 2>/dev/null || true
    sleep 1
  fi
}

require_cmd tailscale
require_cmd python3
require_cmd npm

cd "${ROOT_DIR}"

if ! tailscale status >/dev/null 2>&1; then
  echo "Tailscale login required. Starting QR login..."
  tailscale login --qr
fi

if port_in_use "${FRONTEND_PORT}"; then
  kill_port "${FRONTEND_PORT}"
fi
if port_in_use "${BACKEND_PORT}"; then
  kill_port "${BACKEND_PORT}"
fi
if port_in_use "${FRONTEND_PORT}" || port_in_use "${BACKEND_PORT}"; then
  echo "Ports are still in use. Stop the services or choose different ports." >&2
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

SERVE_BG_FLAG=""
if tailscale serve --help 2>/dev/null | grep -q -- "--bg"; then
  SERVE_BG_FLAG="--bg"
fi

apply_serve() {
  local path="$1"
  local target="$2"
  local attempt=1
  while [[ "${attempt}" -le 5 ]]; do
    local output
    output=$(tailscale serve --https="${EXTERNAL_PORT}" --set-path="${path}" ${SERVE_BG_FLAG} "${target}" 2>&1) && return 0
    if echo "${output}" | grep -qi "etag mismatch"; then
      echo "Serve config busy, retrying (${attempt}/5)..."
      sleep 1
      attempt=$((attempt + 1))
      continue
    fi
    echo "${output}" >&2
    return 1
  done
  echo "Failed to update serve config after retries." >&2
  return 1
}

echo "Mapping frontend to / on https port ${EXTERNAL_PORT} -> ${FRONTEND_PORT}"
apply_serve "/" "http://127.0.0.1:${FRONTEND_PORT}"

echo "Mapping backend to /api on https port ${EXTERNAL_PORT} -> ${BACKEND_PORT}"
apply_serve "/api" "http://127.0.0.1:${BACKEND_PORT}"

sleep 1
echo "Current tailscale serve status:"
tailscale serve status

echo "Services are running. Press Ctrl+C to stop."
wait
