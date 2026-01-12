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

echo "Checking tailscaled daemon..."
if ! systemctl is-active --quiet tailscaled 2>/dev/null; then
  echo "tailscaled service is not running. Attempting to start..."
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl start tailscaled
    sleep 2
    if systemctl is-active --quiet tailscaled; then
      echo "✓ tailscaled service started successfully"
    else
      echo "ERROR: Failed to start tailscaled service" >&2
      echo "Please run: sudo systemctl start tailscaled" >&2
      exit 1
    fi
  else
    echo "ERROR: systemctl not found. Cannot start tailscaled." >&2
    echo "Please start tailscaled manually." >&2
    exit 1
  fi
else
  echo "✓ tailscaled service is running"
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "Tailscale login required. Starting QR login..."
  tailscale login --qr
fi

echo "Tailscale status:"
tailscale status | head -5

echo "Checking tailscale serve support..."
if tailscale serve --help 2>/dev/null | grep -q -- "--bg"; then
  echo "✓ Tailscale serve --bg flag is supported"
else
  echo "⚠ Tailscale serve --bg flag is NOT supported (will use nohup workaround)"
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

echo "Waiting for services to be ready..."
for i in {1..30}; do
  backend_ready=false
  frontend_ready=false

  if curl -s http://127.0.0.1:${BACKEND_PORT}/health >/dev/null 2>&1 || curl -s http://127.0.0.1:${BACKEND_PORT} >/dev/null 2>&1; then
    backend_ready=true
  fi

  if curl -s http://127.0.0.1:${FRONTEND_PORT} >/dev/null 2>&1; then
    frontend_ready=true
  fi

  if [[ "${backend_ready}" == "true" ]] && [[ "${frontend_ready}" == "true" ]]; then
    echo "Both services are ready!"
    break
  fi

  sleep 1
done

SERVE_BG_FLAG=""
SERVE_USE_AMPERSAND=false
if tailscale serve --help 2>/dev/null | grep -q -- "--bg"; then
  SERVE_BG_FLAG="--bg"
else
  SERVE_USE_AMPERSAND=true
fi

SERVE_PIDS=()

apply_serve() {
  local path="$1"
  local target="$2"
  local attempt=1
  while [[ "${attempt}" -le 5 ]]; do
    local output
    if [[ "${SERVE_USE_AMPERSAND}" == "true" ]]; then
      # Run with nohup and detach when --bg is not available
      # Redirect all output to avoid blocking
      nohup tailscale serve --https="${EXTERNAL_PORT}" --set-path="${path}" "${target}" >/dev/null 2>&1 &
      local serve_pid=$!
      # Detach the process so it survives script termination
      disown "${serve_pid}" 2>/dev/null || true
      # Store PID for potential cleanup
      SERVE_PIDS+=("${serve_pid}")

      # Give it time to start and register
      sleep 2

      # Check if tailscale serve command succeeded
      if tailscale serve status 2>&1 | grep -q "${path}"; then
        echo "Successfully configured serve path: ${path}"
        return 0
      fi

      # Check for etag mismatch by trying to read any error output
      # Since we can't easily capture output with nohup, try again on failure
      echo "Serve config may be busy, retrying (${attempt}/5)..."
      # Kill the process we just started
      kill "${serve_pid}" 2>/dev/null || true
      sleep 1
      attempt=$((attempt + 1))
      continue
    else
      output=$(tailscale serve --https="${EXTERNAL_PORT}" --set-path="${path}" ${SERVE_BG_FLAG} "${target}" 2>&1) && return 0
      if echo "${output}" | grep -qi "etag mismatch"; then
        echo "Serve config busy, retrying (${attempt}/5)..."
        sleep 1
        attempt=$((attempt + 1))
        continue
      fi
      echo "${output}" >&2
      return 1
    fi
  done
  echo "Failed to update serve config after retries." >&2
  return 1
}

echo "Mapping frontend to / on https port ${EXTERNAL_PORT} -> localhost:${FRONTEND_PORT}"
if ! apply_serve "/" "localhost:${FRONTEND_PORT}"; then
  echo "ERROR: Failed to configure frontend path. Check tailscale logs." >&2
  exit 1
fi

echo "Mapping backend to /api on https port ${EXTERNAL_PORT} -> localhost:${BACKEND_PORT}"
if ! apply_serve "/api" "localhost:${BACKEND_PORT}"; then
  echo "ERROR: Failed to configure backend path. Check tailscale logs." >&2
  exit 1
fi

echo ""
echo "========================================="
echo "Tailscale Serve Configuration:"
echo "========================================="
tailscale serve status
echo "========================================="
echo ""

if tailscale serve status 2>&1 | grep -q "no serve config"; then
  echo "WARNING: No serve config detected. The configuration may not have persisted." >&2
  echo "This can happen if tailscale serve requires the --bg flag or sudo privileges." >&2
  if [[ "${SERVE_USE_AMPERSAND}" == "true" ]]; then
    echo "Note: Running without --bg flag. Tailscale serve processes:" >&2
    ps aux | grep "[t]ailscale serve" || echo "No tailscale serve processes found" >&2
  fi
fi

echo "Services are running. Press Ctrl+C to stop."
echo "Frontend and Backend will be stopped, but Tailscale serve will persist."
wait
