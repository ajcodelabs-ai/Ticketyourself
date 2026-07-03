#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"

echo "==> Checking prerequisites…"

# ── Backend ──────────────────────────────────────────────────────────────────
if curl -sf http://localhost:8000/api/health > /dev/null 2>&1; then
  echo "    Backend already running at http://localhost:8000 ✓"
else
  echo "    Starting backend…"
  cd "$BACKEND_DIR"
  python server.py &
  BACKEND_PID=$!
  echo "    Backend PID=$BACKEND_PID, waiting for health…"
  for i in $(seq 1 30); do
    if curl -sf http://localhost:8000/api/health > /dev/null 2>&1; then
      echo "    Backend ready ✓"
      break
    fi
    sleep 1
  done
  if ! curl -sf http://localhost:8000/api/health > /dev/null 2>&1; then
    echo "ERROR: Backend did not start in time" >&2
    exit 1
  fi
fi

# ── Frontend ─────────────────────────────────────────────────────────────────
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
if curl -sf "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then
  echo "    Frontend already running at http://localhost:$FRONTEND_PORT ✓"
else
  echo "    Starting frontend…"
  cd "$FRONTEND_DIR"
  yarn dev &
  FRONTEND_PID=$!
  echo "    Frontend PID=$FRONTEND_PID, waiting for ready…"
  for i in $(seq 1 60); do
    if curl -sf "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then
      echo "    Frontend ready ✓"
      break
    fi
    sleep 2
  done
  if ! curl -sf "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then
    echo "ERROR: Frontend did not start in time" >&2
    exit 1
  fi
fi

# ── Run tests ────────────────────────────────────────────────────────────────
cd "$FRONTEND_DIR"
echo "==> Running Playwright E2E tests…"
npx playwright test --config=e2e/playwright.config.ts "$@"
EXIT_CODE=$?

# ── Cleanup ──────────────────────────────────────────────────────────────────
echo "==> Cleaning up…"
if [ -n "${BACKEND_PID:-}" ]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
if [ -n "${FRONTEND_PID:-}" ]; then kill "$FRONTEND_PID" 2>/dev/null || true; fi

exit "$EXIT_CODE"
