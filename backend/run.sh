#!/usr/bin/env bash
# Start the FastAPI backend (bash / Git Bash).
set -e
cd "$(dirname "$0")"
if [ ! -d ".venv" ]; then
  python -m venv .venv
  ./.venv/Scripts/python.exe -m pip install -r requirements.txt
fi
./.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
