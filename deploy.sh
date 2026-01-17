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

# 프론트엔드는 먼저 종료
if port_in_use "${FRONTEND_PORT}"; then
  kill_port "${FRONTEND_PORT}"
fi
if port_in_use "${FRONTEND_PORT}"; then
  echo "Frontend port ${FRONTEND_PORT} is still in use." >&2
  exit 1
fi

# 백엔드 warmup 포트 정리
if port_in_use "${BACKEND_WARMUP_PORT}"; then
  kill_port "${BACKEND_WARMUP_PORT}"
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

# Zero-downtime deployment: 포트를 번갈아 사용
# 현재 사용 중인 포트 확인
CURRENT_PORT=""
NEW_PORT=""
if port_in_use "${BACKEND_PORT}"; then
  CURRENT_PORT="${BACKEND_PORT}"
  NEW_PORT="${BACKEND_WARMUP_PORT}"
elif port_in_use "${BACKEND_WARMUP_PORT}"; then
  CURRENT_PORT="${BACKEND_WARMUP_PORT}"
  NEW_PORT="${BACKEND_PORT}"
else
  # 둘 다 사용 안 함 - 기본 포트 사용
  CURRENT_PORT=""
  NEW_PORT="${BACKEND_PORT}"
fi

echo "Current backend port: ${CURRENT_PORT:-none}"
echo "New backend port: ${NEW_PORT}"

# 새 백엔드 시작
echo "Starting new backend on port ${NEW_PORT}..."
nohup "${VENV_UVICORN}" backend.main:app --host 127.0.0.1 --port "${NEW_PORT}" > "${ROOT_DIR}/backend/debug.log" 2>&1 &
BACKEND_PID=$!
disown "${BACKEND_PID}"

# 새 백엔드 헬스 체크 대기
new_backend_ready=false
for i in {1..60}; do
  if curl -s "http://127.0.0.1:${NEW_PORT}/health" >/dev/null 2>&1; then
    new_backend_ready=true
    echo "New backend is ready! (${i}s)"
    break
  fi
  sleep 1
done

if [[ "${new_backend_ready}" != "true" ]]; then
  echo "ERROR: New backend failed to start" >&2
  kill "${BACKEND_PID}" 2>/dev/null || true
  exit 1
fi

# Tailscale serve 경로를 새 백엔드로 전환 (zero-downtime)
echo "Switching Tailscale serve to port ${NEW_PORT}..."
if command -v tailscale >/dev/null 2>&1; then
  tailscale serve --https=8443 --bg --set-path="/api" "localhost:${NEW_PORT}" 2>/dev/null || true
fi

# 기존 백엔드 종료
if [[ -n "${CURRENT_PORT}" ]] && port_in_use "${CURRENT_PORT}"; then
  echo "Stopping old backend on port ${CURRENT_PORT}..."
  kill_port "${CURRENT_PORT}"
fi

# PID 저장
echo "${BACKEND_PID}" > "${PID_DIR}/backend.pid"
echo "${NEW_PORT}" > "${PID_DIR}/backend.port"
echo "Backend started with PID ${BACKEND_PID} on port ${NEW_PORT}"

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
echo "  Backend:  ${BACKEND_PID} on port ${NEW_PORT} (saved in ${PID_DIR}/backend.pid)"
echo "  Frontend: ${FRONTEND_PID} on port ${FRONTEND_PORT} (saved in ${PID_DIR}/frontend.pid)"
echo ""
echo "Logs:"
echo "  Backend:  ${ROOT_DIR}/backend/debug.log"
echo "  Frontend: ${ROOT_DIR}/frontend/debug.log"
echo ""
echo "To stop services, run:"
echo "  kill \$(cat ${PID_DIR}/backend.pid ${PID_DIR}/frontend.pid)"
echo ""
echo "To view logs:"
echo "  tail -f ${ROOT_DIR}/backend/debug.log"
echo "  tail -f ${ROOT_DIR}/frontend/debug.log"
echo ""
