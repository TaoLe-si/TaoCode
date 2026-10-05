// 「内部错误」指示器（B2：`FatalErrorWidgetFactory` → `IdeMessagePanel` 那个组件）。
//
// 上游形状（`platform/platform-impl/.../status/FatalErrorWidgetFactory.java`）：
//   · 显示名 `status.bar.fatal.error.widget.name`（中文包 =「内部错误」）；
//   · `isConfigurable() = false` 且 `canBeEnabledOn(statusBar) = false`（`:32-42`）——
//     不进勾选清单、用户不能开关，自己按"有没有内部错误"显形；
//   · 内容是**进程内**的 `MessagePool`（不读日志文件）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { INTERNAL_ERROR_WIDGET_NAME, internalErrorLabel, latestInternalError, shouldShowInternalErrors } from '../src/internalErrors.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('the widget name is the upstream string', () => {
  assert.equal(INTERNAL_ERROR_WIDGET_NAME, '内部错误', 'UIBundle.properties:259 status.bar.fatal.error.widget.name')
})

// 有错误才显形（上游那个组件就是"有内容才可见"）。
test('the chip only appears when there are errors', () => {
  assert.equal(shouldShowInternalErrors({ count: 3, latest: [] }, true), true)
  assert.equal(shouldShowInternalErrors({ count: 0, latest: [] }, true), false)
  assert.equal(shouldShowInternalErrors(null, true), false, '还没拉到账时不显')
  assert.equal(shouldShowInternalErrors({ count: 3, latest: [] }, false), false, '预览模式（没有宿主）不显')
})

test('the label carries the count', () => {
  assert.equal(internalErrorLabel(1), '1 个内部错误')
  assert.equal(internalErrorLabel(12), '12 个内部错误')
})

// tooltip 用最新那一条（账本按时间追加，最后一条最新）。
test('the tooltip shows the latest entry', () => {
  const errors = { count: 2, latest: [{ time: '10:00:00', message: '第一条' }, { time: '10:00:05', message: '第二条' }] }
  assert.equal(latestInternalError(errors), '10:00:05 第二条')
  assert.equal(latestInternalError({ count: 0, latest: [] }), '')
  assert.equal(latestInternalError(null), '')
})

// —— 宿主侧 ——

test('the host keeps a per-session ledger of ERROR lines', () => {
  const hpp = read('native/diagnostics.hpp')
  assert.match(hpp, /Json internal_errors\(\);/, '要有查询面')
  assert.match(hpp, /void record_internal_error\(const std::string& level, const std::string& message\);/)
  const cpp = read('native/diagnostics.cpp')
  assert.match(cpp, /record_internal_error\(level, message\);/, 'event() 要顺手记一笔')
  assert.match(cpp, /if \(level != "ERROR" \|\| message.empty\(\)\) return;/, '只记 ERROR（WARN/INFO 不进这个账）')
  assert.match(cpp, /kMaxInternalErrors = 50/, '要有上限')
  // 关键：**不在 event 之外另读日志文件** —— 跨 session 的日志会把上次启动的错误算进来。
  assert.doesNotMatch(cpp, /internal_errors[\s\S]{0,400}ifstream/, '账本是进程内的，不读日志文件')
})

test('the route is registered on both sides', () => {
  assert.match(read('native/main.cpp'), /case "app\.internalErrors"_h: result = taocode::diagnostics::internal_errors\(\); break;/)
  assert.match(read('src/bridge.ts'), /'app\.logPaths' \| 'app\.internalErrors' \| 'app\.specialPaths'/)
})

// —— 接线 ——

test('the chip is a self-contained component, not inlined in App.vue', () => {
  const app = read('src/App.vue')
  assert.match(app, /<InternalErrorsChip :active="Boolean\(workspace\)" :is-desktop="isDesktop" :show-log="showLog" \/>/)
  const chip = read('src/components/InternalErrorsChip.vue')
  assert.match(chip, /request<InternalErrors>\('app\.internalErrors'\)/, '拉取走宿主路由')
  assert.match(chip, /setInterval\(\(\) => void refresh\(\), 30000\)/, '只涨不跌的计数：30s 一次就够')
  // 「显示日志」那一行在上一轮拆分里跟着弹层搬进了对话框（`InternalErrorsDialog.vue`），
  // 断言体不动，只把 read 路径改指搬过去的文件。
  assert.match(read('src/components/InternalErrorsDialog.vue'), /void showLog\(\)/, '列表底部要有去日志的出路')
})
