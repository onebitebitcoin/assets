#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_PORT=50001
BACKEND_PORT=50000
BACKEND_WARMUP_PORT=50002
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
  echo "[DEBUG] Checking port ${port}..."
  if command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -ti tcp:"${port}" 2>/dev/null || true)
    echo "[DEBUG] lsof found PIDs: '${pids}'"
  elif command -v ss >/dev/null 2>&1; then
    pids=$(ss -ltnp 2>/dev/null | awk -v port=":${port}" '$0 ~ port {print $NF}' | sed -E 's/.*pid=([0-9]+).*/\1/' | sort -u)
    echo "[DEBUG] ss found PIDs: '${pids}'"
  fi
  if [[ -n "${pids}" ]]; then
    echo "Stopping process on port ${port}: ${pids}"
    kill ${pids} 2>/dev/null || true
    # 포트가 해제될 때까지 대기 (최대 10초)
    for i in {1..10}; do
      if ! port_in_use "${port}"; then
        echo "Port ${port} is now free."
        return 0
      fi
      echo "[DEBUG] Waiting for port ${port} to be released... (${i}/10)"
      sleep 1
    done
    # 여전히 사용 중이면 강제 종료
    echo "Force killing process on port ${port}..."
    kill -9 ${pids} 2>/dev/null || true
    sleep 2
  else
    echo "[DEBUG] No process found on port ${port}"
  fi
}

require_cmd python3
require_cmd npm

cd "${ROOT_DIR}"

# 모든 기존 서비스 정리
echo "Cleaning up existing services..."
for port in "${FRONTEND_PORT}" "${BACKEND_PORT}" "${BACKEND_WARMUP_PORT}"; do
  if port_in_use "${port}"; then
    kill_port "${port}"
  fi
done

# 포트가 모두 해제되었는지 확인
for port in "${FRONTEND_PORT}" "${BACKEND_PORT}" "${BACKEND_WARMUP_PORT}"; do
  if port_in_use "${port}"; then
    echo "ERROR: Port ${port} is still in use." >&2
    exit 1
  fi
done
echo "All ports are free."

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

# 백엔드 시작
echo "Starting backend on port ${BACKEND_PORT}..."
nohup "${VENV_UVICORN}" backend.main:app --host 127.0.0.1 --port "${BACKEND_PORT}" > "${ROOT_DIR}/backend/debug.log" 2>&1 &
BACKEND_PID=$!
echo "${BACKEND_PID}" > "${PID_DIR}/backend.pid"
disown "${BACKEND_PID}"

# 백엔드 헬스 체크 대기
backend_ready=false
for i in {1..60}; do
  if curl -s "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    backend_ready=true
    echo "Backend is ready! (${i}s)"
    break
  fi
  sleep 1
done

if [[ "${backend_ready}" != "true" ]]; then
  echo "ERROR: Backend failed to start" >&2
  kill "${BACKEND_PID}" 2>/dev/null || true
  exit 1
fi

echo "Backend started with PID ${BACKEND_PID}"

echo "Starting frontend on ${FRONTEND_PORT}..."
VITE_API_BASE="${VITE_API_BASE:-https://ubuntu.golden-ghost.ts.net:8443/api}" \
  nohup npm --prefix frontend run dev -- --host 127.0.0.1 --port "${FRONTEND_PORT}" --strictPort > "${ROOT_DIR}/frontend/debug.log" 2>&1 &
FRONTEND_PID=$!
echo "${FRONTEND_PID}" > "${PID_DIR}/frontend.pid"
disown "${FRONTEND_PID}"
echo "Frontend started with PID ${FRONTEND_PID} (detached)"

echo "Waiting for frontend to be ready..."
for i in {1..30}; do
  if curl -s http://127.0.0.1:${FRONTEND_PORT} >/dev/null 2>&1; then
    echo "Frontend is ready! (${i}s)"
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
echo "  Backend:  ${BACKEND_PID} on port ${BACKEND_PORT} (saved in ${PID_DIR}/backend.pid)"
echo "  Frontend: ${FRONTEND_PID} on port ${FRONTEND_PORT} (saved in ${PID_DIR}/frontend.pid)"
echo ""
echo "Logs:"
echo "  Backend:  ${ROOT_DIR}/backend/debug.log"
echo "  Frontend: ${ROOT_DIR}/frontend/debug.log"
echo ""
echo "To stop services, run:"
echo "  ./clear.sh"
echo ""
echo "To view logs:"
echo "  tail -f ${ROOT_DIR}/backend/debug.log"
echo "  tail -f ${ROOT_DIR}/frontend/debug.log"
echo ""
