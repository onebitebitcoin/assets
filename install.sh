#!/usr/bin/env bash
set -euo pipefail

VENV=".venv"
if [ ! -d "${VENV}" ]; then
  python3 -m venv "${VENV}"
fi

source "${VENV}/bin/activate"
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt
npm --prefix frontend install
