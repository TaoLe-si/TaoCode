#!/usr/bin/env bash
# 一条命令跑完全套门禁（并行改代码后复查用）。
#
# 用法：
#   bash scripts/verify-parity.sh            # 前端 + 文档/判决（快，约 1–2 分钟）
#   bash scripts/verify-parity.sh --native   # 再加原生构建 + ctest（慢，约 4–6 分钟）
#
# 为什么要它：本项目的门禁散在六处（tsc / npm test / vite build / 原生构建 / ctest / 判决与不变量专项），
# 多主体并行改动时逐个手敲容易漏一条，而"漏跑的那条"正是会红的那条（本轮真实发生过）。
# 每条都打印 PASS/FAIL 与尾部输出，最后给一张汇总表；任一失败则 exit 1。
set -u
cd "$(dirname "$0")/.." || exit 2

run() {
  local name="$1"; shift
  local log="build/verify-${name}.log"
  if "$@" > "$log" 2>&1; then
    printf 'PASS  %-22s %s\n' "$name" "$(tail -1 "$log" | cut -c1-90)"
    return 0
  fi
  printf 'FAIL  %-22s 见 %s\n' "$name" "$log"
  tail -20 "$log" | sed 's/^/      /'
  return 1
}

failed=0
run tsc npx vue-tsc --noEmit || failed=1
run tests npm test || failed=1
run build npx vite build || failed=1
run verdicts node --test tests/module-size.test.mjs tests/routing-parity.test.mjs \
  tests/b1-verdict.test.mjs tests/b2-verdict.test.mjs tests/b3-verdict.test.mjs \
  tests/b4-verdict.test.mjs tests/b5-verdict.test.mjs tests/b6-verdict.test.mjs \
  tests/b7-verdict.test.mjs tests/verdict-generated.test.mjs \
  tests/settings-keys-parity.test.mjs tests/native-callback-capture.test.mjs || failed=1
run inventory python scripts/enumerate_inventory.py --check || failed=1

if [ "${1:-}" = "--native" ]; then
  run native cmd //c "scripts\\build-native-locked.bat" || failed=1
  run ctest cmd //c "scripts\\run-ctest.bat" || failed=1
fi

echo
if [ "$failed" -eq 0 ]; then
  echo "全部通过。"
else
  echo "有失败项（见上面 FAIL 行与对应 build/verify-*.log）。"
fi
exit "$failed"
