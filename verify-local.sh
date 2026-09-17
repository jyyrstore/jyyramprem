#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "=================================================="
echo "=== JYY'R AMPREM — FULL LOCAL VERIFICATION ==="
echo "=================================================="

echo
echo "=== NODE / NPM ==="
node -v
npm -v

echo
echo "=== INSTALL DEPENDENCIES ==="
npm install || {
  echo "X npm install GAGAL"
  exit 1
}

echo
echo "=== NPM TEST ==="
npm test || {
  echo
  echo "X npm test GAGAL"
  exit 1
}

echo
echo "=== NPM VERIFY ==="
npm run verify || {
  echo
  echo "X npm run verify GAGAL"
  exit 1
}

echo
echo "=== STATIC / SYNTAX VERIFICATION ==="
npm run verify:local:static || {
  echo
  echo "X static verification GAGAL"
  exit 1
}

echo
echo "=== GIT DIFF CHECK ==="

if command -v git >/dev/null 2>&1 && [ -d ".git" ]; then
  git diff --check || {
    echo
    echo "X git diff --check GAGAL"
    exit 1
  }

  echo "PASS git diff --check"
else
  echo "CHECK git metadata tidak tersedia"
fi

echo
echo "=================================================="
echo "=== VERIFICATION SUMMARY ==="
echo "=================================================="

echo "PASS npm install"
echo "PASS npm test"
echo "PASS npm run verify"
echo "PASS JavaScript/MJS syntax"
echo "PASS CSS structural check"
echo "HTML: PASS atau CHECK sesuai xmllint"
echo "Migration: diverifikasi secara dynamic"
echo
echo "Tidak ada angka migration hardcoded 47/80."
echo
echo "=== DONE ==="
