#!/usr/bin/env bash
set -euo pipefail

run_section() {
  local name="$1"
  shift
  echo "==> ${name}"
  if "$@"; then
    echo "${name}: success"
  else
    echo "${name}: failed"
    exit 1
  fi
}

PYTHON="python3"
if [ -x ".venv/bin/python" ]; then
  PYTHON=".venv/bin/python"
fi

run_section "Backend tests" "$PYTHON" -m pytest backend/tests
run_section "Frontend tests" npm --prefix frontend run test -- --run
