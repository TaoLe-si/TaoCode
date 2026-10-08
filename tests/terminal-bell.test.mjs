// `src/terminalEvents.ts` 响铃那一半的判据：上游那一档门真的被读、缺省是开的、
// 事件形状按 deliverTermOutput 的口径判、出口与订阅者各走各的、响铃**不进**缓冲。
//
// 上游依据（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`，逐行核过）：
//   · `plugins/terminal/src/org/jetbrains/plugins/terminal/TerminalOptionsProvider.kt:76`
//     —— `var mySoundBell: Boolean = true`（缺省：响铃是**开**的）
//   · 同文件 `:219-226` —— `var audibleBell: Boolean` 的 get/set（set 里变值才 `fireSettingsChanged()`）
//   · `plugins/terminal/src/org/jetbrains/plugins/terminal/JBTerminalSystemSettingsProvider.java:64-66`
//     —— `audibleBell()` = `TerminalOptionsProvider.getInstance().getAudibleBell()`
//   · `plugins/terminal/frontend/src/com/intellij/terminal/frontend/view/impl/TerminalSessionController.kt:111-113`
//     —— `is TerminalBeepEvent -> if (settings.audibleBell()) Toolkit.beep()`：**门只有这一档**
//   · `plugins/terminal/src/org/jetbrains/plugins/terminal/block/output/TerminalAlarmManager.kt:12-16`
//     —— 块视图那侧多一档 `commandIsRunning`（来自 shell 集成 OSC 133；本仓拿不到这个输入 ⇒ 不复制）
//   · BEL 的来源 `.../frontend/session/ghostty/GhosttyTerminalSession.kt:276-278`（`onBell()` ⇒ `TerminalBeepEvent`）
//     —— 上游也是在**会话/宿主层**认出响铃再交给视图，不是在渲染层，所以本仓放在 native 读线程里。
//
// 中文措辞：`plugins/terminal/resources/messages/` 里只有 `TerminalBundle.properties` 与
// `TerminalDeprecatedMessagesBundle.properties` 两份，`find plugins/terminal -name "*zh*"` 零命中
// ⇒ 没有 zh 本地化包，UI 文案一律「无法核实」，这里不判文案。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  deliverTermBell, setTerminalBellOutlet, subscribeTermBell, terminalBellMakesSound,
  TERMINAL_BELL_AUDIBLE_DEFAULT,
} from '../src/terminalEvents.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = (file) => readFileSync(join(root, file), 'utf8')
// 读源码形状的断言一律先剥掉行注释：M7 那次注入（`// if (rang) report_bell();`）证明
// 不剥的话，注释掉的代码照样匹配得上 —— "该红不红"的判据等于没有判据。
// 只会因过度剥离产生**假失败**（响），不会假通过，方向是对的。
const code = (file) => source(file).replace(/\/\/[^\n]*/g, '')

/** 每次换一个干净的计数出口；用完记得 `setTerminalBellOutlet(null)` 回默认。 */
function countingOutlet(seen = []) {
  const outlet = (id) => { seen.push(id) }
  setTerminalBellOutlet(outlet)
  return seen
}

test.afterEach(() => { setTerminalBellOutlet(null) })

// --- 上游那一档门 -------------------------------------------------------------------------

test('缺省值钉住上游：响铃是开的（TerminalOptionsProvider.kt:76 的 mySoundBell = true）', () => {
  assert.equal(TERMINAL_BELL_AUDIBLE_DEFAULT, true)
  assert.equal(terminalBellMakesSound(), true, '没给设置就走缺省 true')
  assert.equal(terminalBellMakesSound({}), true, '空设置对象也是缺省 true')
})

test('门真的被读：audibleBell=false 就不响，=true 就响（TerminalSessionController.kt:111-113）', () => {
  assert.equal(terminalBellMakesSound({ audibleBell: false }), false)
  assert.equal(terminalBellMakesSound({ audibleBell: true }), true)
  // 垃圾值不算"关"：只有显式的 false 才关得掉（缺省是开的，不能被 undefined/null 顶掉）
  assert.equal(terminalBellMakesSound({ audibleBell: undefined }), true)
  const rang = countingOutlet()
  assert.equal(deliverTermBell(7, { audibleBell: false }), true, '门关掉，事件本身仍是合法的')
  assert.deepEqual(rang, [], '门关着还走出口 = 上游那档门没接上')
  assert.equal(deliverTermBell(7), true)
  assert.deepEqual(rang, [7], '门开着必须响一次')
})

// --- 事件形状 -----------------------------------------------------------------------------

test('term.bell 的形状判定与 deliverTermOutput 同一口径：非正整数 id 一律 false 且不响', () => {
  const rang = countingOutlet()
  for (const bad of [undefined, null, '3', Number.NaN, 0, -1, 1.5, {}, []]) {
    assert.equal(deliverTermBell(bad), false, `${JSON.stringify(bad)} 不该被当成一次响铃`)
  }
  assert.deepEqual(rang, [], '形状不对还去响 = 把垃圾事件送进了发声出口')
  assert.equal(deliverTermBell(1), true, '终端 id 是正的且永不复用（native/terminal.hpp 的 create()）')
  assert.equal(deliverTermBell(64), true, '上限那一格（64 台）也是合法的')
  assert.deepEqual(rang, [1, 64])
})

// --- 出口 / 订阅者是两件事 ------------------------------------------------------------------

test('订阅者收 id，且与门无关：静音时面板照样能闪（闪不闪 ≠ 有没有声音）', () => {
  const seen = []
  const stop = subscribeTermBell(11, (id) => { seen.push(id) })
  const rang = countingOutlet()
  assert.equal(deliverTermBell(11, { audibleBell: false }), true)
  assert.deepEqual(seen, [11], '静音挡掉了订阅者')
  assert.deepEqual(rang, [], '静音时不该走发声出口')
  assert.equal(deliverTermBell(11), true)
  assert.deepEqual(seen, [11, 11], '同一格第二次响铃也要报给订阅者')
  assert.deepEqual(rang, [11])
  assert.equal(deliverTermBell(12), true, '别的终端的响铃仍是合法事件')
  assert.deepEqual(seen, [11, 11], '按 id 订的，不能串到别的终端')
  assert.deepEqual(rang, [11, 12], '出口收的是**哪一格**响的（接线要按这个闪对应窗格）')
  stop()
  assert.equal(deliverTermBell(11), true)
  assert.deepEqual(seen, [11, 11], '取消订阅后不再收到')
})

test('多个订阅者各订各的（面板 + 别处），出口只走一次', () => {
  const first = [], second = []
  const a = subscribeTermBell(21, (id) => { first.push(id) })
  const b = subscribeTermBell(21, (id) => { second.push(id) })
  const rang = countingOutlet()
  deliverTermBell(21)
  assert.deepEqual(first, [21])
  assert.deepEqual(second, [21])
  assert.deepEqual(rang, [21], '两个订阅者不该让出口响两遍')
  a(); b()
})

test('出口响不出声（抛出去）不打断终端事件链，仍算已处理', () => {
  setTerminalBellOutlet(() => { throw new Error('AudioContext 不可用') })
  const seen = []
  const stop = subscribeTermBell(31, (id) => { seen.push(id) })
  assert.equal(deliverTermBell(31), true, '响铃失败不能变成"这条消息不是终端事件"')
  assert.deepEqual(seen, [31])
  stop()
})

test('默认出口没有 AudioContext 时安静跳过（复用 notificationBeeper 的降级，不自己抛）', () => {
  // 不注入出口 ⇒ 走 beep()。node 里没有 AudioContext，`audioContextCtor()` 返回 undefined，
  // 于是这一声就是"没有"，但整条链不能炸。
  assert.doesNotThrow(() => assert.equal(deliverTermBell(41), true))
})

// --- 与 term.output 相反的口径：响铃不缓冲 -------------------------------------------------

test('没有订阅者时不缓冲：迟到的响铃不补（与 term.output 的 256 块缓冲相反）', () => {
  const seen = []
  assert.equal(deliverTermBell(51), true, '没订着也是合法事件（native 那边确确实实响了）')
  const stop = subscribeTermBell(51, (id) => { seen.push(id) })
  assert.deepEqual(seen, [], '订阅时把过去攒下的响铃补响一遍 = 为一件已经过去的事按铃')
  deliverTermBell(51)
  assert.deepEqual(seen, [51])
  stop()
})

// --- 两头都在，中间那段是本批的请求 --------------------------------------------------------

test('通道宿主侧两头齐：native 读线程扫 BEL 且原样转流，出口复用既有通知提示音', () => {
  const hpp = code('native/terminal.hpp')
  assert.match(hpp, /using BellCb = std::function<void\(int id\)>;/, '宿主没有响铃回调类型')
  assert.match(hpp, /void on_bell\(BellCb callback\);/, 'Manager 上没有 on_bell（接线无处可挂）')
  assert.match(hpp, /BellCb on_bell_;/, 'Manager 没留回调的位置')
  const cpp = code('native/terminal.cpp')
  assert.match(cpp, /bell_scanner\.feed\(\{bytes, size\}\)/, '读线程没有在看 BEL')
  assert.match(cpp, /if \(rang\) report_bell\(\);/, '认出来的响铃没被报给宿主（扫了但通道断在这儿）')
  assert.match(cpp, /Manager::on_bell\(BellCb callback\)/, 'Manager::on_bell 没实现 ⇒ 接线无处可挂')
  assert.match(cpp, /on_output\(id, \{bytes, size\}\);/, 'BEL 被从流里吃掉了（宿主只观察，不许改流）')
  assert.match(source('native/terminal.cpp'), /on_output\(id, \{bytes, size\}\);\s*\/\/ verbatim console bytes, ANSI intact/,
    '原样转发那句留痕注释被改掉了（流语义的证据就在这句上）')
  const events = source('src/terminalEvents.ts')
  assert.match(events, /import \{ beep \} from '\.\/notificationBeeper\.ts'/,
    '发声没复用既有通知出口（自造一个就是多一条没人管的发声链）')
  const scanner = code('native/terminal_bell.cpp')
  assert.match(scanner, /case State::quoted:[\s\S]*?if \(code == bel\) state_ = State::ground;/,
    '串状态里的 BEL 会被当成响铃 ⇒ 每次改标题都响一次')
})

test('CMakeLists 注册了这条 ctest（基线 39 → 40，计数自证）', () => {
  const cmake = source('CMakeLists.txt')
  assert.match(cmake, /add_executable\(terminal_bell_test native\/terminal_bell_test\.cpp native\/terminal_bell\.cpp\)/)
  assert.match(cmake, /add_test\(NAME terminal_bell_scan COMMAND terminal_bell_test\)/)
  assert.match(cmake, /add_library\(taocode_terminal native\/terminal\.cpp native\/terminal_bell\.cpp\)/,
    '实现没进 taocode_terminal ⇒ 主程序链接不到')
  // 计数是**全局共享**的（本仓 20 路并发，每条 lane 都可能往 CMakeLists 加自己的 add_test），
  // 所以这里钉的是「不少于本 lane 落地时的 40 条」这个下限，而不是写死 == 40 ——
  // 写死会让**别的** lane 加一条 ctest 就把本文件判红（2026-10-06 实测：dap_values 加了第 41 条）。
  // 真正属于本 lane 的那条注册由上面 `add_test(NAME terminal_bell_scan …)` 的正则逐字钉住，
  // 那条一旦被删/改名立刻红，与本计数无关。
  const added = cmake.split('\n').filter((line) => line.startsWith('add_test(')).length
  assert.ok(added >= 40, `add_test 行数应不少于 40（本 lane 落地时的基线），实得 ${added} —— CMakeLists 被截断或被改坏？`)
})

test('本批没动前端那一半：没有响铃复选框，也没有第二个 BEL 源（termset 拒做的那件事）', () => {
  const panel = source('src/components/TerminalPanel.vue')
  assert.match(panel, /const emit = defineEmits<\{ focusTerminal: \[\] \}>\(\)/,
    '面板的 emits 与本批交接时不一致 ⇒ 请求里的净行数核算要重算')
  assert.doesNotMatch(panel, /onBell/, '面板已经自己接了 xterm 的 onBell ⇒ 与宿主通道形成**双响**')
  for (const file of ['src/App.vue', 'src/components/TerminalPanel.vue', 'src/settingsModel.ts']) {
    assert.doesNotMatch(source(file), /audibleBell|响铃/, `${file} 里出现了响铃开关（发声通道接通前不许放）`)
  }
  const bridge = source('src/bridge.ts')
  assert.doesNotMatch(bridge, /term\.bell/,
    'bridge.ts 已分派 term.bell ⇒ 本批那条请求已落地，请把这条判据改成"分派到了 deliverTermBell"')
})
