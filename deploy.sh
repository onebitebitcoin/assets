#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_PORT=50001
BACKEND_PORT=50000
if [[ "$#" -gt 0 ]]; then
  echo "Unknown option: $*" >&2
  echo "Usage: ./deploy.sh" >&2
  exit 1
fi

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

require_cmd python3
require_cmd npm

cd "${ROOT_DIR}"

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
VITE_API_BASE="${VITE_API_BASE:-https://ubuntu.golden-ghost.ts.net:8443/api}" \
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
echo ""
echo "To stop services, run:"
echo "  kill \$(cat ${PID_DIR}/backend.pid ${PID_DIR}/frontend.pid)"
echo ""
echo "Tailscale serve is not configured by this script."
echo "Run: sudo ./tailscale.sh [--reset]"
echo ""
echo "To view logs:"
echo "  tail -f ${LOG_DIR}/backend.log"
echo "  tail -f ${LOG_DIR}/frontend.log"
echo ""
