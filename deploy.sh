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

echo "Tailscale version:"
tailscale version

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

LOG_DIR="${ROOT_DIR}/logs"
mkdir -p "${LOG_DIR}"
PID_DIR="${ROOT_DIR}/pids"
mkdir -p "${PID_DIR}"

echo "Starting backend on ${BACKEND_PORT}..."
nohup "${VENV_UVICORN}" backend.main:app --host 127.0.0.1 --port "${BACKEND_PORT}" > "${LOG_DIR}/backend.log" 2>&1 &
BACKEND_PID=$!
echo "${BACKEND_PID}" > "${PID_DIR}/backend.pid"
disown "${BACKEND_PID}"
echo "Backend started with PID ${BACKEND_PID} (detached)"

echo "Starting frontend on ${FRONTEND_PORT}..."
nohup npm --prefix frontend run dev -- --host 127.0.0.1 --port "${FRONTEND_PORT}" > "${LOG_DIR}/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "${FRONTEND_PID}" > "${PID_DIR}/frontend.pid"
disown "${FRONTEND_PID}"
echo "Frontend started with PID ${FRONTEND_PID} (detached)"

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

apply_serve() {
  local path="$1"
  local target="$2"
  local attempt=1
  local log_file="${LOG_DIR}/tailscale-serve-$(echo "${path}" | tr '/' '_').log"

  while [[ "${attempt}" -le 5 ]]; do
    # ALWAYS use --bg flag for persistent configuration
    # Without --bg, the config only exists while the foreground process runs
    echo "Attempt ${attempt}: Running tailscale serve --https=${EXTERNAL_PORT} --bg --set-path=${path} ${target}" > "${log_file}"

    local output
    output=$(tailscale serve --https="${EXTERNAL_PORT}" --bg --set-path="${path}" "${target}" 2>&1)
    local exit_code=$?

    echo "Exit code: ${exit_code}" >> "${log_file}"
    echo "Output:" >> "${log_file}"
    echo "${output}" >> "${log_file}"

    if [[ ${exit_code} -eq 0 ]]; then
      # Give it a moment to register
      sleep 1

      # Verify the config was set
      local serve_status
      serve_status=$(tailscale serve status 2>&1)
      echo "Serve status:" >> "${log_file}"
      echo "${serve_status}" >> "${log_file}"

      if echo "${serve_status}" | grep -q "${path}"; then
        echo "✓ Successfully configured serve path: ${path}"
        return 0
      else
        echo "Warning: Command succeeded but path not found in status" >&2
        cat "${log_file}" >&2
      fi
    fi

    # Check if it was an etag mismatch (concurrent modification)
    if echo "${output}" | grep -qi "etag mismatch"; then
      echo "Serve config busy, retrying (${attempt}/5)..."
      sleep 1
      attempt=$((attempt + 1))
      continue
    fi

    # Check if --bg flag is not supported
    if echo "${output}" | grep -qi "unknown flag.*--bg\|flag provided but not defined.*--bg"; then
      echo "ERROR: tailscale serve --bg flag is not supported on this version" >&2
      echo "Please upgrade tailscale to a version that supports --bg flag:" >&2
      echo "  sudo tailscale update" >&2
      echo "" >&2
      echo "Current tailscale version:" >&2
      tailscale version >&2
      return 1
    fi

    # Other error
    echo "Failed to configure serve path (${attempt}/5):" >&2
    echo "${output}" >&2

    if [[ ${attempt} -lt 5 ]]; then
      sleep 1
      attempt=$((attempt + 1))
      continue
    else
      break
    fi
  done

  echo "" >&2
  echo "Failed to update serve config after ${attempt} retries." >&2
  if [[ -f "${log_file}" ]]; then
    echo "Last attempt log:" >&2
    cat "${log_file}" >&2
  fi
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
  echo "This usually indicates that tailscale serve --bg failed to save the configuration." >&2
  echo "Check the logs in ${LOG_DIR}/ for details." >&2
  exit 1
fi

echo ""
echo "========================================="
echo "Deployment Complete!"
echo "========================================="
echo ""
echo "Services are running in the background and will persist even if SSH disconnects."
echo ""
echo "Service PIDs:"
echo "  Backend:  ${BACKEND_PID} (saved in ${PID_DIR}/backend.pid)"
echo "  Frontend: ${FRONTEND_PID} (saved in ${PID_DIR}/frontend.pid)"
echo ""
echo "Logs:"
echo "  Backend:  ${LOG_DIR}/backend.log"
echo "  Frontend: ${LOG_DIR}/frontend.log"
echo "  Tailscale: ${LOG_DIR}/tailscale-serve-*.log"
echo ""
echo "To stop services, run:"
echo "  kill \$(cat ${PID_DIR}/backend.pid ${PID_DIR}/frontend.pid)"
echo ""
echo "To view logs:"
echo "  tail -f ${LOG_DIR}/backend.log"
echo "  tail -f ${LOG_DIR}/frontend.log"
echo ""
