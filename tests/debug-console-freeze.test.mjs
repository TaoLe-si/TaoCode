// 调试控制台「暂停输出」的规则、接线，以及**这两处引用的上游行号本身**
// （`src/debugConsoleFreeze.ts` + `src/components/DebugConsolePane.vue`）。
//
// 上游：`platform/execution-impl/src/com/intellij/execution/actions/PauseOutputAction.java`
//   · `:18` 类声明 = `extends ToggleAction`（不是 `AbstractAction`，也不是别的行）；
//   · `:31` 读 `consoleView.isOutputPaused()` / `:38` 写 `consoleView.setOutputPaused(flag)`；
//   · `:48-65` 是 `update()`：`:53` 要 `canPause()`，`:59-60` 要「进程还没结束 **或** 有延迟输出」，
//     `:64` 把结论交给 `presentation.setEnabledAndVisible(isEnabled)` ⇒ **不可用就连同按钮一起消失**。
//   · 注册：`platform/execution-impl/resources/intellij.platform.execution.impl.actions.xml:72` 的 `id="PauseOutput"`。
//
// 为什么这个文件还要核行号：仓里的引用门控（`tests/source-citations.test.mjs`）只收
// 「完整上游路径 + 行号」那一种形状，而这些注释里的第二段第三段是**裸行号**（路径写在上一行）。
// 裸行号写歪了门控全绿、按图索骥的人扑空 —— 本桶已经真出过一次（`docs/batch-2026-10-06-dap3.md` 记的订正）。
// 所以这里逐行开参考树核内容：行号对不上就红。参考树不在时那一条**跳过**（与门控同一策略）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const PAUSE_PATH = 'platform/execution-impl/src/com/intellij/execution/actions/PauseOutputAction.java'
const XML_PATH = 'platform/execution-impl/resources/intellij.platform.execution.impl.actions.xml'

const freeze = await import('../src/debugConsoleFreeze.ts')

test('开关出不出 = 上游 `setEnabledAndVisible` 那一条：canPause 且（会话在 或 有积压）', () => {
  // 会话在跑 / 停在断点：上游看的是「进程结没结束」，不是「此刻在执行还是停住」⇒ 两档都出现。
  assert.equal(freeze.pauseOutputVisible({ processRunning: true, hasDeferred: false }), true)
  // 会话已经结束、也没有暂停中的积压 ⇒ 不可用 ⇒ 整格不出现（不是画个灰按钮）。
  assert.equal(freeze.pauseOutputVisible({ processRunning: false, hasDeferred: false }), false)
  // 会话结束了但暂停着、还有没跟着滚过去的行：上游 `:59` 的 `hasDeferredOutput()` 那一支仍然为真。
  assert.equal(freeze.pauseOutputVisible({ processRunning: false, hasDeferred: true }), true)
  // `canPause()` 为假时两支都不看（上游 `:53-54` 直接 isEnabled=false）。本仓恒真，但判据得在这。
  assert.equal(freeze.pauseOutputVisible({ canPause: false, processRunning: true, hasDeferred: true }), false)
  assert.equal(freeze.pauseOutputVisible({ processRunning: false, hasDeferred: true }), true, '缺省走 CONSOLE_CAN_PAUSE')
  assert.equal(freeze.CONSOLE_CAN_PAUSE, true, '本仓 DOM 滚动条永远可冻结（写死才有「恒真」这一条的依据）')
})

test('冻结的是跟随滚动、不拦数据：积压计数与恢复时的那一下', () => {
  assert.equal(freeze.shouldFollowOutput(false), true, '没暂停就跟随')
  assert.equal(freeze.shouldFollowOutput(true), false, '暂停后不再自动滚到底')
  assert.equal(freeze.markForPause(true, 42), 42, '按下暂停时记下当前长度')
  assert.equal(freeze.markForPause(false, 42), null, '取消暂停把标记清掉')
  assert.equal(freeze.deferredLines(50, 42), 8, '差值就是没跟着滚过去的行数')
  assert.equal(freeze.deferredLines(40, 42), 0, '会话重启后长度变短 ⇒ 归零，不给负数')
  assert.equal(freeze.deferredLines(50, null), 0, '没暂停过就没有积压')
  assert.equal(freeze.hasDeferredOutput(50, 42), true)
  assert.equal(freeze.hasDeferredOutput(42, 42), false, '一条没多 ⇒ 不算积压')
  assert.equal(freeze.shouldRevealOnResume(50, 42), true, '有过积压才在恢复时滚到底')
  assert.equal(freeze.shouldRevealOnResume(42, 42), false, '本来就在底部，不必再滚一次')
  assert.equal(freeze.deferredOutputNote(50, 42), '8 行未显示')
  assert.equal(freeze.deferredOutputNote(42, 42), '', '没积压时不给空占位文案')
  assert.equal(freeze.PAUSE_OUTPUT_LABEL, '暂停输出')
})

test('接线：调试控制台那格的开关按可见性渲染，且读的是会话状态', () => {
  const view = readFileSync('src/components/DebugConsolePane.vue', 'utf8')
  assert.match(view, /const pauseAvailable = computed\(\(\) => pauseOutputVisible\(\{/, '可见性没走规则层')
  assert.match(view, /processRunning: dapState\.running/, '「进程还没结束」那一档没接会话状态')
  assert.match(view, /hasDeferred: pending\.value > 0/, '「有延迟输出」那一档没接积压计数')
  assert.match(view, /<button v-if="pauseAvailable" class="chip-x debug-console-action"/,
    '开关没按可见性渲染 ⇒ 会话结束后仍画着一个点不动的假控件')
  assert.match(view, /if \(!CONSOLE_CAN_PAUSE \|\| !pauseAvailable\.value\) return/, '切换函数还从判据里绕开')
  assert.match(view, /import \{ dapConsole, dapState \} from '\.\.\/bridge'/, '没 import 会话状态')
})

test('行号锚点：裸行号引用的那几行内容逐字对得上参考树（参考树不在则跳过）', () => {
  if (!existsSync(REF)) return
  const line = (path, at) => readFileSync(join(REF, path), 'utf8').split('\n')[at - 1]
  const pins = [
    [18, 'final class PauseOutputAction extends ToggleAction implements DumbAware {'],
    [31, 'return consoleView != null && consoleView.isOutputPaused();'],
    [38, 'consoleView.setOutputPaused(flag);'],
    [48, 'public void update(@NotNull AnActionEvent event) {'],
    [53, 'if (consoleView == null || !consoleView.canPause()) {'],
    [59, 'isEnabled = handler != null && !handler.isProcessTerminated() ||'],
    [60, 'consoleView.hasDeferredOutput();'],
    [64, 'presentation.setEnabledAndVisible(isEnabled);'],
  ]
  for (const [at, text] of pins) assert.equal(line(PAUSE_PATH, at).trim(), text, `PauseOutputAction.java:${at} 不是那一行`)
  assert.equal(line(PAUSE_PATH, 65).trim(), '}', 'update() 的收尾就在 :65')
  assert.match(line(XML_PATH, 72), /<action id="PauseOutput" class="com\.intellij\.execution\.actions\.PauseOutputAction"\/>/)

  // 本仓两处注释引用的行号：新行号必须在，旧写法不许留下来（旧的那几条是抄来的、指歪了）。
  const module = readFileSync('src/debugConsoleFreeze.ts', 'utf8')
  const view = readFileSync('src/components/DebugConsolePane.vue', 'utf8')
  for (const text of [module, view]) {
    assert.match(text, /PauseOutputAction\.java:18/, 'ToggleAction 的类声明行没写成实测的 :18')
    assert.match(text, /:48-65/, 'update() 那一段没写成实测的 :48-65')
    assert.match(text, /:64/, 'setEnabledAndVisible 那一行没进引用')
    assert.doesNotMatch(text, /:44-52/, '「可用判据」还指着 update() 之前的空行段')
    assert.doesNotMatch(text, /:31-43/, '读写那两条还圈到 getActionUpdateThread 头上')
    assert.doesNotMatch(text, /:50-52/, '「有延迟输出」那一条还指着 update() 的开头')
    assert.doesNotMatch(text, /:63/, 'setEnabledAndVisible 不在 :63（那是取 Presentation 的那一行）')
    assert.doesNotMatch(text, /:58/, '进程未结束那一判据不在 :58（那是 handler 的取值行）')
  }
  assert.doesNotMatch(module, /`:19`/, 'ToggleAction 又写回旧的那个行号')
  assert.match(module, /isOutputPaused\(\)`（`:31`）/, '读 isOutputPaused 的行号没钉在 :31')
  assert.match(module, /setOutputPaused\(\)`（`:38`）/, '写 setOutputPaused 的行号没钉在 :38')
  assert.match(view, /:29-40/, 'isSelected/setSelected 两个方法整体没写成 :29-40')
})
