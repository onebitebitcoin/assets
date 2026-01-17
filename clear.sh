#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_PORT=50001
BACKEND_PORT=50000
BACKEND_WARMUP_PORT=50002
PID_DIR="${ROOT_DIR}/pids"

echo "========================================="
echo "Clearing all running services..."
echo "========================================="

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
  return 1
}

kill_port() {
  local port="$1"
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -ti tcp:"${port}" 2>/dev/null || true)
  elif command -v ss >/dev/null 2>&1; then
    pids=$(ss -ltnp 2>/dev/null | awk -v port=":${port}" '$0 ~ port {print $NF}' | sed -E 's/.*pid=([0-9]+).*/\1/' | sort -u)
  fi
  if [[ -n "${pids}" ]]; then
    echo "Killing process on port ${port}: ${pids}"
    kill ${pids} 2>/dev/null || true
    sleep 1
    # 여전히 있으면 강제 종료
    if port_in_use "${port}"; then
      echo "Force killing port ${port}..."
      kill -9 ${pids} 2>/dev/null || true
      sleep 1
    fi
  fi
}

# 포트 기반으로 프로세스 종료
echo ""
echo "Checking ports..."

for port in "${FRONTEND_PORT}" "${BACKEND_PORT}" "${BACKEND_WARMUP_PORT}"; do
  if port_in_use "${port}"; then
    echo "  Port ${port}: in use"
    kill_port "${port}"
    if ! port_in_use "${port}"; then
      echo "  Port ${port}: cleared"
    else
      echo "  Port ${port}: failed to clear"
    fi
  else
    echo "  Port ${port}: free"
  fi
done

# PID 파일 기반으로도 확인
echo ""
echo "Checking PID files..."

if [[ -f "${PID_DIR}/backend.pid" ]]; then
  pid=$(cat "${PID_DIR}/backend.pid" 2>/dev/null || true)
  if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
    echo "  Killing backend PID ${pid}"
    kill "${pid}" 2>/dev/null || true
    sleep 1
    kill -9 "${pid}" 2>/dev/null || true
  fi
  rm -f "${PID_DIR}/backend.pid"
fi

if [[ -f "${PID_DIR}/frontend.pid" ]]; then
  pid=$(cat "${PID_DIR}/frontend.pid" 2>/dev/null || true)
  if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
    echo "  Killing frontend PID ${pid}"
    kill "${pid}" 2>/dev/null || true
    sleep 1
    kill -9 "${pid}" 2>/dev/null || true
  fi
  rm -f "${PID_DIR}/frontend.pid"
fi

rm -f "${PID_DIR}/backend.port" 2>/dev/null || true

# 최종 상태 확인
echo ""
echo "========================================="
echo "Final status:"
echo "========================================="

all_clear=true
for port in "${FRONTEND_PORT}" "${BACKEND_PORT}" "${BACKEND_WARMUP_PORT}"; do
  if port_in_use "${port}"; then
    echo "  Port ${port}: STILL IN USE"
    all_clear=false
  else
    echo "  Port ${port}: free"
  fi
done

echo ""
if [[ "${all_clear}" == "true" ]]; then
  echo "All services cleared successfully."
else
  echo "WARNING: Some ports are still in use."
  echo "You may need to manually kill processes."
fi
