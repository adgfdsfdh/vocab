#!/usr/bin/env bash
# Единая проверка готовности проекта: npm install -> typecheck -> тесты -> сборка.
# Запуск: bash init.sh   (на Windows — через Git Bash)
# Код выхода: 0 = PASS, 1 = FAIL, 2 = проект ещё не создан.

set -u
cd "$(dirname "$0")"

RESULTS=()
FAILED=0

run_step() {
  local name="$1"; shift
  echo ""
  echo "=== $name: $* ==="
  if "$@"; then
    RESULTS+=("PASS  $name")
  else
    RESULTS+=("FAIL  $name")
    FAILED=1
  fi
}

has_script() {
  node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)" 2>/dev/null
}

if [ ! -f package.json ]; then
  echo "package.json не найден: проект ещё не создан (это ожидаемо до F01)."
  echo "Проверки typecheck / test / build пропущены."
  echo ""
  echo "ИТОГ: NO PROJECT — начните с F01 (feature_list.json)."
  exit 2
fi

# Защита от утечки секретов: .env.local не должен отслеживаться git
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vqE '(^|/)\.env\.example$'; then
    RESULTS+=("FAIL  secrets (.env* файл в git!)")
    FAILED=1
  else
    RESULTS+=("PASS  secrets (.env-файлы не в git)")
  fi
fi

if [ -f package-lock.json ]; then
  run_step "install" npm ci --no-audit --no-fund
else
  run_step "install" npm install --no-audit --no-fund
fi

for step in typecheck test build; do
  if has_script "$step"; then
    run_step "$step" npm run "$step"
  else
    RESULTS+=("FAIL  $step (нет скрипта \"$step\" в package.json)")
    FAILED=1
  fi
done

echo ""
echo "================ ИТОГ ================"
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo "======================================"
if [ "$FAILED" -eq 0 ]; then
  echo "PASS"
  exit 0
else
  echo "FAIL"
  exit 1
fi
