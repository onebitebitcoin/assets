#!/usr/bin/env bash
set -euo pipefail

kill_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids=$(lsof -ti tcp:"${port}") || true
    if [ -n "${pids}" ]; then
      echo "Stopping process on port ${port}: ${pids}"
      kill ${pids} 2>/dev/null || true
    fi
  fi
}

kill_port 50001
kill_port 50000

VENV=".venv"
UVICORN="uvicorn"
if [ -x "${VENV}/bin/uvicorn" ]; then
  UVICORN="${VENV}/bin/uvicorn"
fi

"${UVICORN}" backend.main:app --reload --host 127.0.0.1 --port 50000 &
BACKEND_PID=$!

npm --prefix frontend run dev -- --host 127.0.0.1 --port 50001 &
FRONTEND_PID=$!

trap 'kill ${BACKEND_PID} ${FRONTEND_PID} 2>/dev/null || true' EXIT
wait
