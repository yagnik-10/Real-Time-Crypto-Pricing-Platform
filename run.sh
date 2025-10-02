#!/usr/bin/env bash
set -euo pipefail

prefix_logs() {
  sed -u "s/^/[$1] /"
}

run_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
    return $?
  fi
  if command -v corepack >/dev/null 2>&1; then
    # Try without activating (avoids privileged symlinks)
    corepack pnpm "$@" && return 0 || true
  fi
  # Fallback to npx ephemeral pnpm (no global install, no prompts)
  npx -y pnpm@10.15.1 "$@"
}

cleanup() {
  echo "[INFO] Stopping services..."
  pkill -f 'next dev -p 3000' || true
  pkill -f 'tsx src/index.ts' || true
  pkill -f '/server/src/index.ts' || true
  pkill -f 'node .*next' || true
}

trap cleanup EXIT

echo "[INFO] Starting Project Pluto Fullstack Assessment setup..."

echo "[INFO] Cleaning up existing processes on ports 8080 and 3000..."
(lsof -ti tcp:3000 -sTCP:LISTEN || true) | xargs -r kill -9 || true
(lsof -ti tcp:8080 -sTCP:LISTEN || true) | xargs -r kill -9 || true

echo "[INFO] Installing dependencies with pnpm..."
run_pnpm install --recursive | prefix_logs pnpm
echo "[SUCCESS] Dependencies installed successfully"

echo "[INFO] Protobuf code already exists, skipping generation..."
# If needed later: pnpm -w codegen

echo "[INFO] Installing Playwright Chromium browser..."
pushd server >/dev/null
./node_modules/.bin/playwright install chromium | prefix_logs playwright
popd >/dev/null
echo "[SUCCESS] Playwright Chromium installed successfully"

export NEXT_PUBLIC_API_BASE_URL="http://localhost:8080"
echo "[INFO] Environment configured: NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL"

echo "[INFO] Starting backend and frontend servers..."
(
  cd server
  ./node_modules/.bin/tsx src/index.ts 2>&1 | prefix_logs server
) &
(
  cd web
  run_pnpm dev 2>&1 | prefix_logs web
) &

sleep 1
echo "[SUCCESS] All services are running!"
echo "[INFO] Backend: http://localhost:8080"
echo "[INFO] Frontend: http://localhost:3000"
echo "[INFO] Press Ctrl+C to stop all services"

wait
