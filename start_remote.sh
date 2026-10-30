#!/usr/bin/env bash
set -e

# Change to script directory
cd "$(dirname "$0")"

echo "==================================================="
echo "  Antigravity Remote Studio (反重力移动工作台)"
echo "==================================================="

# Check Python
if command -v python3 >/dev/null 2>&1; then
    PY_CMD="python3"
elif command -v python >/dev/null 2>&1; then
    PY_CMD="python"
else
    echo "[ERROR] Python 3 is required."
    exit 1
fi

# Setup Virtual Environment
if [ ! -d "venv" ]; then
    echo "[INFO] Creating Python virtual environment..."
    $PY_CMD -m venv venv
fi

source venv/bin/activate

# Install requirements
if ! python -c "import fastapi, uvicorn, websockets, psutil" >/dev/null 2>&1; then
    echo "[INFO] Installing dependencies..."
    pip install -r requirements.txt -q
fi

# Run Gateway
echo "[START] Launching Antigravity Remote Studio..."
exec python -m gateway.app
