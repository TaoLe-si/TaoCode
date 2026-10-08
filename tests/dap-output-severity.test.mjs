// DAP `output` 事件的 category → 严重度分档（`src/dapOutputSeverity.ts`），
// 以及它接到调试控制台那格上的形状（`src/components/DebugConsolePane.vue`）。
//
// 判据分四层，缺一层就退回「全塌成一级」那个形状：
//   ① 规范点名的五条 category 各自落哪一档 + **认不出/缺省 ⇒ `console`** 那条兜底；
//   ② 呈现轴（`console` 与 `stdout` 同严重度但不同呈现，历史别名 `output` 必须跟 `stdout` 同呈现）；
//   ③ 「要用户看一眼」的阈值 `<= 2` —— 同一条阈值在 `src/lspServerMessages.ts:108`/`:333` 上
//      历史上被注入改成过 `<= 4`，所以这里连带把磁盘上那两处一起钉住；
//   ④ 引用的**上游行号本身**逐行开参考树核内容（裸行号写歪了门控收不到，同 `tests/debug-console-freeze.test.mjs`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'

const sev = await import('../src/dapOutputSeverity.ts')
const repoFile = relative => readFileSync(join(root, relative), 'utf8')

// ── ① 分档本体 ────────────────────────────────────────────────────────────────────────

test('规范那五条 category 各自落一档：stderr 错误 / important 警告 / stdout·console 信息 / telemetry 静默', () => {
  assert.equal(sev.dapOutputSeverityOf('stderr'), 1, '「debuggee 的错误程序输出」必须是最高档')
  assert.equal(sev.dapOutputSeverityOf('important'), 2, '「important and highly visible」⇒ 要看见但不是错误')
  assert.equal(sev.dapOutputSeverityOf('stdout'), 3, 'debuggee 的正常输出')
  assert.equal(sev.dapOutputSeverityOf('console'), 3, '调试器给默认消息 UI 的那一条')
  assert.equal(sev.dapOutputSeverityOf('telemetry'), 4, '「发去遥测而不是显示给用户」= 最低档')
  // 数值口径与 `src/lspServerLog.ts:27` 的 `LspLogLevel` 一致：**1 最严重**，反过来就全错。
  assert.ok(sev.dapOutputSeverityOf('stderr') < sev.dapOutputSeverityOf('important'))
  assert.ok(sev.dapOutputSeverityOf('important') < sev.dapOutputSeverityOf('stdout'))
  assert.ok(sev.dapOutputSeverityOf('console') < sev.dapOutputSeverityOf('telemetry'))
})

test('边界：历史别名 `output` 与 `stdout` 同档；认不出/缺省走规范那条兜底（= console），不猜也不升级', () => {
  // `output` 在**当前**规范清单里没有（老版本写它「normal output，改用 stdout」），
  // 适配器还在发 ⇒ 不显式认它就会掉进兜底档：严重度看着一样（都是 3），**呈现**会从 normal 变 system
  // = 把程序输出当调试器自己的消息画。所以这条既钉档也钉呈现。
  assert.equal(sev.dapOutputSeverityOf('output'), 3)
  assert.equal(sev.dapOutputLineClass('output'), sev.dapOutputLineClass('stdout'))
  assert.equal(sev.dapOutputLineClass('output'), 'sev-normal')
  // 兜底那一组：空串 / 缺省 / 自造名字 / 非字符串 —— 全都按 `console` 落，且不升到错误、不压成静默。
  for (const junk of ['', '   ', 'build', 'server', 'trace', 'stdout2', 'std err']) {
    assert.equal(sev.dapOutputSeverityOf(junk), 3, `认不出的名字必须走兜底（console 档）：${JSON.stringify(junk)}`)
    assert.equal(sev.dapOutputLineClass(junk), 'sev-system')
  }
  for (const notAString of [undefined, null, 42, {}, ['stderr']]) {
    assert.equal(sev.dapOutputSeverityOf(notAString), 3, '非字符串不能凭空升级成错误')
  }
})

test('边界：大小写与首尾空格不另起一档（native 是原样透传适配器给的字符串）', () => {
  assert.equal(sev.dapOutputSeverityOf('Stderr'), 1, '一条错误因为大小写被画成普通行 = 分档白做')
  assert.equal(sev.dapOutputSeverityOf('  IMPORTANT '), 2)
  assert.equal(sev.dapOutputLineClass('STDOUT'), 'sev-normal')
  // 带子形态的写法按冒号前那一段落档，**不**替子形态编新档。
  assert.equal(sev.dapOutputSeverityOf('stderr:fatal'), 1)
  assert.equal(sev.dapOutputSeverityOf('important: hint'), 2)
  // 冒号在开头（`:stdout`）不是一段合法 category ⇒ 整串认不出 ⇒ 兜底，不剥成 stdout。
  assert.equal(sev.dapOutputSeverityOf(':stdout'), 3)
})

// ── ② 呈现轴 ──────────────────────────────────────────────────────────────────────────

test('呈现轴与严重度分家：console 是 SYSTEM、stdout 是 NORMAL、telemetry 是 MUTED、important 是 WARNING', () => {
  assert.equal(sev.dapOutputPresentationOf('stderr'), 'error')
  assert.equal(sev.dapOutputPresentationOf('important'), 'warning')
  assert.equal(sev.dapOutputPresentationOf('console'), 'system')
  assert.equal(sev.dapOutputPresentationOf('stdout'), 'normal')
  assert.equal(sev.dapOutputPresentationOf('output'), 'normal')
  assert.equal(sev.dapOutputPresentationOf('telemetry'), 'muted')
  assert.equal(sev.dapOutputPresentationOf('whatever'), 'system', '兜底 = console 的呈现')
  // 同一档严重度、不同呈现：这一条就是「两轴不能合成一个类名」的理由。
  assert.equal(sev.dapOutputSeverityOf('console'), sev.dapOutputSeverityOf('stdout'))
  assert.notEqual(sev.dapOutputLineClass('console'), sev.dapOutputLineClass('stdout'))
})

// ── ③ 阈值：要用户看一眼的那一带 ───────────────────────────────────────────────────────

test('阈值是 `<= 2`（ERROR/WARNING 两档），不是 `<= 4`：本仓既有那两处一起钉', () => {
  assert.equal(sev.DAP_OUTPUT_ATTENTION_MAX_SEVERITY, 2, '与 src/lspServerMessages.ts 同一口径，改成 4 就等于四档全塌')
  assert.equal(sev.dapOutputNeedsAttention('stderr'), true)
  assert.equal(sev.dapOutputNeedsAttention('important'), true)
  assert.equal(sev.dapOutputNeedsAttention('stdout'), false)
  assert.equal(sev.dapOutputNeedsAttention('console'), false)
  assert.equal(sev.dapOutputNeedsAttention('telemetry'), false)
  assert.equal(sev.dapOutputNeedsAttention(''), false, '兜底那一档不该把每条认不出的输出都喊成要看一眼')
  // 类名上的 sev-attention 必须与同一个阈值同判：样式与判据共用一条线。
  assert.equal(sev.dapOutputLineClass('stderr'), 'sev-error sev-attention')
  assert.equal(sev.dapOutputLineClass('important'), 'sev-warning sev-attention')
  assert.equal(sev.dapOutputLineClass('console'), 'sev-system')
  assert.equal(sev.dapOutputLineClass('telemetry'), 'sev-muted')

  // 磁盘上那两处历史被改动过的阈值：必须仍是 `severity <= 2`。
  // **按符号体取，不写行号** —— 那个文件在共享工作树里被别的批次加过行（今天 618 行、写这条时 425 行），
  // 拿行号取的那一版判据自己就会先红，红的还不是它要钉的那个错。
  const messages = repoFile('src/lspServerMessages.ts')
  const groupBody = messages.slice(
    messages.indexOf('export function lspMessageGroupIdOf'),
    messages.indexOf('export function lspMessageDisplayIdOf'))
  const logBody = messages.slice(
    messages.indexOf('function handleLogMessage'),
    messages.indexOf('/**\n * showMessageRequest'))
  assert.ok(groupBody.length > 0 && logBody.length > 0, '两个符号体没取到（符号改名了 ⇒ 这条阈值也不再被钉着）')
  assert.match(groupBody, /severity <= 2/, 'lspMessageGroupIdOf 的阈值不再是一条 2')
  assert.match(logBody, /severity <= 2/, 'handleLogMessage 的阈值不再是一条 2')
  assert.doesNotMatch(groupBody, /severity <= 4/, '分组那一处被注入成 <= 4 过：Info/Log 会全跑进 errors 组')
  assert.doesNotMatch(logBody, /severity <= 4/, '入队那一处被注入成 <= 4 过：Info/Log 会全弹成通知')
  assert.doesNotMatch(messages, /severity <= 4/, '全文件不许出现第二套阈值')
  assert.equal((messages.match(/severity <= 2/g) ?? []).length, 2, '两处都要在（少一处=被改走了）')
})

// ── ④ 计数与接线 ──────────────────────────────────────────────────────────────────────

test('计数只数「要看一眼」那两档，且分档是按行各自的 category 判的', () => {
  assert.deepEqual(sev.countDapOutputAttention([]), { error: 0, warning: 0, bySeverity: [0, 0, 0, 0, 0] })
  assert.deepEqual(sev.countDapOutputAttention([{ category: 'console' }, { category: 'stdout' }]),
    { error: 0, warning: 0, bySeverity: [0, 0, 0, 2, 0] },
    'INFO 档不计入标题（否则每条调试器消息都在喊）')
  const counted = sev.countDapOutputAttention([
    { category: 'stderr' }, { category: 'stderr' }, { category: 'important' },
    { category: 'telemetry' }, { category: 'console' }, { category: 'build' },
  ])
  assert.equal(counted.error, 2)
  assert.equal(counted.warning, 1)
  assert.deepEqual(counted.bySeverity, [0, 2, 1, 2, 1], 'bySeverity 逐档：兜底那条与 console 同档（INFO）')
  // 大小写混着来也不能漏计。
  assert.equal(sev.countDapOutputAttention([{ category: 'STDERR' }]).error, 1)
})

test('接线：控制台按分档类名画行、标题按阈值出计数，且不再拿适配器的原始 category 当类名', () => {
  const view = repoFile('src/components/DebugConsolePane.vue')
  assert.match(view, /from '\.\.\/dapOutputSeverity'/, '控制台没 import 分档模块')
  assert.match(view, /import \{ countDapOutputAttention, dapOutputLineClass \} from '\.\.\/dapOutputSeverity'/, '两个消费点没一起接上')
  assert.match(view, /:class="dapOutputLineClass\(entry\.category\)"/, '行上的类名没走分档')
  assert.doesNotMatch(view, /:class="entry\.category"/, '还在拿适配器的原始 category 当类名（撞上一条 CSS 才算一档）')
  assert.match(view, /const attention = computed\(\(\) => countDapOutputAttention\(dapConsole\)\)/, '计数没读控制台')
  assert.match(view, /v-if="attentionNote"/, '标题那格只在真有计数时出现（不留恒为 0 的假读数）')
  for (const cls of ['sev-error', 'sev-warning', 'sev-system', 'sev-muted']) {
    assert.match(view, new RegExp(`\\.debug-console-line\\.${cls} \\{`), `呈现档 ${cls} 没有对应样式`)
  }
  assert.doesNotMatch(view, /\.debug-console-line\.(stderr|telemetry) \{/, '样式还留在按 category 命名的那一版')
})

// ── ⑤ 上游行号本身（参考树不在就跳过，与引用门控同一策略）──────────────────────────────

test('上游锚点逐行核内容：分档照的那几张表确实长在这些行上', (t) => {
  if (!existsSync(join(REF, 'platform/lang-api/src/com/intellij/build/events/MessageEvent.java'))) {
    t.skip('参考树不在')
    return
  }
  const at = (path, n) => readFileSync(join(REF, path), 'utf8').split('\n')[n - 1].trim()
  const KIND = 'platform/lang-api/src/com/intellij/build/events/MessageEvent.java'
  const TYPE = 'platform/ide-core/src/com/intellij/execution/ui/ConsoleViewContentType.java'
  const COLOR = 'platform/lang-impl/src/com/intellij/openapi/options/colors/pages/ANSIColoredConsoleColorsPage.java'
  const SESSION = 'platform/xdebugger-impl/src/com/intellij/xdebugger/impl/XDebugSessionImpl.kt'
  const TREE = 'platform/lang-impl/src/com/intellij/build/BuildTreeConsoleView.java'
  const pins = [
    // IDEA 错误树那族的分级本体（注释里引的就是这一行）。
    [KIND, 20, 'enum Kind {'],
    [KIND, 21, 'ERROR, WARNING, INFO, STATISTICS, SIMPLE'],
    [KIND, 22, '}'],
    // 只有 ERROR/WARNING/INFO 三档往树上报 ⇒ STATISTICS/SIMPLE = 本仓第 4 档的依据。
    [TREE, 664, 'if (eventKind == MessageEvent.Kind.ERROR || eventKind == MessageEvent.Kind.WARNING || eventKind == MessageEvent.Kind.INFO) {'],
    // 上游唯一那张「输出名字 → 内容类型」的表（stdout/stderr 两档照它）。
    [COLOR, 116, 'ADDITIONAL_HIGHLIGHT_DESCRIPTORS.put("stdsys", ConsoleViewContentType.SYSTEM_OUTPUT_KEY);'],
    [COLOR, 117, 'ADDITIONAL_HIGHLIGHT_DESCRIPTORS.put("stdout", ConsoleViewContentType.NORMAL_OUTPUT_KEY);'],
    [COLOR, 119, 'ADDITIONAL_HIGHLIGHT_DESCRIPTORS.put("stderr", ConsoleViewContentType.ERROR_OUTPUT_KEY);'],
    // 内容类型本体：important 落的那一格 + console/stdout/stderr/telemetry 四格的定义行。
    [TYPE, 45, 'public static final ConsoleViewContentType LOG_WARNING_OUTPUT = new ConsoleViewContentType("LOG_WARNING_OUTPUT", LOG_WARNING_OUTPUT_KEY);'],
    [TYPE, 47, 'public static final ConsoleViewContentType NORMAL_OUTPUT = new ConsoleViewContentType("NORMAL_OUTPUT", NORMAL_OUTPUT_KEY);'],
    [TYPE, 48, 'public static final ConsoleViewContentType ERROR_OUTPUT = new ConsoleViewContentType("ERROR_OUTPUT", ERROR_OUTPUT_KEY);'],
    [TYPE, 49, 'public static final ConsoleViewContentType SYSTEM_OUTPUT = new ConsoleViewContentType("SYSTEM_OUTPUT", SYSTEM_OUTPUT_KEY);'],
    // 调试器自己往控制台写的行用的就是 SYSTEM_OUTPUT ⇒ console 档的呈现照这一条。
    [SESSION, 951, 'console.print(message, ConsoleViewContentType.SYSTEM_OUTPUT)'],
  ]
  for (const [path, n, text] of pins) assert.equal(at(path, n), text, `${path.split('/').pop()}:${n} 不是那一行`)

  // 本仓注释里的引用形状必须与实测行号一致（裸行号只在这一层能被钉住）。
  const module = repoFile('src/dapOutputSeverity.ts')
  assert.match(module, /MessageEvent\.java:20-22/, '错误树分级没钉在实测的 :20-22')
  assert.match(module, /BuildTreeConsoleView\.java:664/, '「STATISTICS/SIMPLE 不上树」没钉在实测的 :664')
  assert.match(module, /ANSIColoredConsoleColorsPage\.java:116-125/, '着色页那张表没写成实测的 :116-125')
  assert.match(module, /XDebugSessionImpl\.kt:951/, 'console 档的呈现依据没指到实测的 :951')
  // dapfix：`stdout` 那一档的依据行原先写成 `:118`（那是 `stdin`→USER_INPUT_KEY），实测在 `:117`。
  assert.match(module, /`ANSIColoredConsoleColorsPage\.java:117` 的 `stdout`/, 'stdout 档的依据没钉在实测的 :117')
  assert.doesNotMatch(module, /ANSIColoredConsoleColorsPage\.java:118/, '又指回 :118（那是 stdin）')
  // 同一条表里 `stdin`/`stderr` 两行的实测位置也顺手钉住：将来上游加行导致漂移时这条会先红。
  assert.equal(at(COLOR, 118), 'ADDITIONAL_HIGHLIGHT_DESCRIPTORS.put("stdin", ConsoleViewContentType.USER_INPUT_KEY);')
  assert.equal(at(COLOR, 125), 'ADDITIONAL_HIGHLIGHT_DESCRIPTORS.put("logExpired", ConsoleViewContentType.LOG_EXPIRED_ENTRY);')
})
