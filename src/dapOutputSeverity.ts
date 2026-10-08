// DAP `output` 事件的 **category → 严重度分档**（桶 12 调试域收尾，代号 dap4）。
//
// 为什么要这一层：`src/bridge.ts:666-667` 把适配器的 `output` 事件原样收进 `dapConsole`
// （只补一个「缺省 = `console`」），`src/components/DebugConsolePane.vue` 则把
// `entry.category` **直接当 CSS 类名**画出去。于是「分档」这件事在本仓的实际形状是：
// `stderr` 恰好命中仓里那条 `.stderr { color: var(--error) }` 才变红、`telemetry` 恰好命中
// 那条才变灰，`important` 与 `stdout`/`console`/`output` 以及任何适配器自造的名字**全塌成一级**
// —— 而 DAP 规范里 `important` 写的是「important and highly visible information」，
// 适配器真发它的时候界面按普通行处理，等于没这条档。
//
// 上游坐标（本机 intellij-community 树，逐条 `awk NR==n` 数过，**没有编造行号**）：
//   · **参考树里没有 DAP `output` 事件的 category→severity 映射**：
//     `platform/xdebugger-impl`（frontend/backend/rpc/ui/src 全树）`grep -rn "OutputEvent"` 零命中，
//     `grep -rn "category"` 在该域只命中设置页类目与测试桩（`DebuggerConfigurable.java:93-94`、
//     `XDebuggerSettingManagerImpl.java:28` 那类，与输出无关）—— IDEA 的 DAP 协议本体是
//     `intellij.cidr.debugger.dap`（**闭源模块**，本机树里只有 `.idea/inspectionProfiles/idea_default.xml:1348`
//     那一行模块名）⇒ 这条映射**无法核实**，本模块按**公开 DAP 协议语义**实现，
//     呈现档则落到下面这几条真实存在的上游内容类型上。
//   · 控制台内容类型本体：`platform/ide-core/src/com/intellij/execution/ui/ConsoleViewContentType.java`
//     `:37-40`（四个 TextAttributesKey：`NORMAL`/`ERROR`/`USER_INPUT`/`SYSTEM`）、
//     `:42-46`（`LOG_DEBUG`/`LOG_VERBOSE`/`LOG_INFO`/`LOG_WARNING`/`LOG_ERROR` 五档日志）、
//     `:47-50`（四个 ConsoleViewContentType 实例 + `USER_INPUT`）、`:52`（`OUTPUT_TYPES` 只有四个）。
//   · 上游**确实有一张「输出名字 → 内容类型」的表**，但不是 DAP 的，是控制台着色页那张：
//     `platform/lang-impl/src/com/intellij/openapi/options/colors/pages/ANSIColoredConsoleColorsPage.java:116-125`
//     （`:116` `stdsys`→SYSTEM_OUTPUT_KEY、`:117` `stdout`→NORMAL_OUTPUT_KEY、`:118` `stdin`→USER_INPUT_KEY、
//     `:119` `stderr`→ERROR_OUTPUT_KEY、`:120-124` `logError`…`logDebug`→LOG_*）。
//     ⇒ 本仓的 `stdout`/`stderr` 两档**逐字照这一条**；`important`/`console`/`telemetry` 那张表里没有，
//     按下面每条注释里点名的依据落档。
//   · 调试器自己往控制台写的那几行用 `SYSTEM_OUTPUT`：
//     `platform/xdebugger-impl/src/com/intellij/xdebugger/impl/XDebugSessionImpl.kt:951`、`:956`、`:958`
//     ⇒ 本仓 `console`（= 调试器给客户端的默认消息 UI 那一档）落 `system` 呈现。
//   · 「严重度分档」在本仓的既有口径不是新的：`src/lspServerLog.ts` 的 `LspLogLevel`（1 错误 / 2 警告 / 3 信息 / 4 日志）、
//     `src/lspServerMessages.ts` 的 `lspMessageGroupIdOf`（`severity <= 2` → errors/warnings 组）与同文件
//     `handleLogMessage`（`severity <= 2` → 进通知队列，否则只写日志）—— 本模块沿用**同一套四档 +
//     同一条 `<= 2` 阈值**，不再造第二个刻度。（这两处阈值磁盘上都是 `<= 2`；历史上有被注入改成 `<= 4` 的记录，
//     判据 `tests/dap-output-severity.test.mjs` 里连带把这条阈值一起钉住 —— 引用**按符号名不按行号**：
//     那个文件在共享工作树里被别的批次加过行，行号今天对、明天就歪。）
//   · IDEA **错误树**那一族的分级本体（本仓四档对的就是它，逐行数过）：
//     `platform/lang-api/src/com/intellij/build/events/MessageEvent.java:20-22`
//     `enum Kind { ERROR, WARNING, INFO, STATISTICS, SIMPLE }`；
//     同族读取处 `platform/lang-impl/src/com/intellij/build/BuildTreeConsoleView.java:659-675`
//     （`reportMessageKind`：只有 `:664` 那三档 ERROR/WARNING/INFO 才往树上报，STATISTICS/SIMPLE 不上树）。
//     ⇒ 本仓的对应：**1=ERROR、2=WARNING、3=INFO、4=STATISTICS/SIMPLE（不上树那一档）**，
//     阈值 `<= 2` = 「ERROR 与 WARNING 这两档要用户看一眼」。
//     上游这条映射（category→Kind）在本参考树里**同样不存在**（见上面那条 `grep OutputEvent` 零命中）
//     ⇒ 落档按公开协议语义做，`Kind` 的名字与顺序才是照抄的。
//
// 公开协议语义（https://microsoft.github.io/debug-adapter-protocol/specification 的 `Output` 事件，
// 2026-10-06 抓取）：`category` 未指定**或客户端认不出**时按 `console` 处理；
// `stdout` = 「debuggee 的正常程序输出」；`stderr` = 「debuggee 的错误程序输出」；
// `console` = 「显示在客户端默认消息 UI」；`important` = 「重要且需要高可见度的信息」；
// `telemetry` = 「发去遥测而不是显示给用户」。
// 当前规范页列的就是这五条；**`output` 不在清单里**（历史别名，老版本规范写它「normal output，已废弃，改用 `stdout`」）
// ⇒ 本仓仍认它，并按 `stdout` 同档落（适配器还在发它：不认就会掉进「认不出 ⇒ console」那一档，
// 呈现从 normal 变 system，等于把程序输出当调试器消息）。

/** 四档，数值与 `src/lspServerLog.ts` 的 `LspLogLevel` 同口径：**1 最严重**。 */
export type DapOutputSeverity = 1 | 2 | 3 | 4

/** 呈现档（对应上游 `ConsoleViewContentType` 的哪一格，见文件头那三条实测坐标）。 */
export type DapOutputPresentation = 'error' | 'warning' | 'system' | 'normal' | 'muted'

/** 一条控制台输出的最小形状（`src/bridge.ts:499` 的 `dapConsole` 元素就是这个形状）。 */
export interface DapOutputLine {
  category: string
}

/** 「要用户看一眼」的阈值：与 `src/lspServerMessages.ts` 的 `lspMessageGroupIdOf`/`handleLogMessage` 同一条 `<= 2`。 */
export const DAP_OUTPUT_ATTENTION_MAX_SEVERITY = 2

/** 规范点名的那五个 category 在规范里的**兜底档**（认不出/缺省 ⇒ `console`）。 */
const CONSOLE_SEVERITY: DapOutputSeverity = 3

function normalize(category: unknown): string {
  // native 是原样透传适配器给的字符串（`native/dap_shaping.cpp:58`），大小写与空格不归一
  // 就会让 `Stderr` 掉进兜底档、把一条错误当普通行画。认不出仍然只走兜底，不猜。
  if (typeof category !== 'string') return ''
  const text = category.trim().toLowerCase()
  // 个别适配器把子形态用冒号拼在 category 里（`stderr: fatal` 那种）。规范正文没有这张子形态表
  // ⇒ 只按冒号前那一段落档（**不**替子形态编档位），带不带子形态都不会把一条错误画成普通行。
  const colon = text.indexOf(':')
  return colon > 0 ? text.slice(0, colon) : text
}

/**
 * 这一行控制台输出是**哪一档**（1 错误 / 2 警告 / 3 信息 / 4 静默）。
 * 认不出的名字一律走规范那条兜底（= `console` 的 3），既不凭空升级为错误、也不凭空压成静默。
 */
export function dapOutputSeverityOf(category: unknown): DapOutputSeverity {
  switch (normalize(category)) {
    // 「debuggee 的错误程序输出」⇒ 规范里唯一一条明确的错误档。
    case 'stderr': return 1
    // 「important and highly visible information」⇒ 要用户看见但不是错误 ⇒ 警告档
    // （呈现落上游 `LOG_WARNING_OUTPUT`，`ConsoleViewContentType.java:45`：参考树没有「important」这一格）。
    case 'important': return 2
    // debuggee 的正常输出：`ANSIColoredConsoleColorsPage.java:117` 的 `stdout`→NORMAL_OUTPUT。
    // （**留痕 · dapfix**：这里原先写 `:118`。逐行重数参考树：`:117` 才是 `put("stdout", NORMAL_OUTPUT_KEY)`，
    //  `:118` 是 `put("stdin", USER_INPUT_KEY)` —— 与本文件头 `:26` 那条「`:117` `stdout`」统一。
    //  钉内容的判据在 `tests/dap-output-severity.test.mjs` 的「上游锚点逐行核内容」那一条。）
    case 'stdout': return 3
    // 历史别名（规范当前清单里没有它）：与 `stdout` 同档，见文件头那条理由。
    case 'output': return 3
    // 调试器自己的消息 ⇒ 上游 `XDebugSessionImpl.kt:951` 那三行用的 SYSTEM_OUTPUT。
    // 严重度仍是 INFO 那一档（`MessageEvent.Kind:21`）：它是「上树」的，不是遥测。
    case 'console': return CONSOLE_SEVERITY
    // 「发去遥测而不是显示给用户」⇒ 本仓最低一档（= 上游 `reportMessageKind` 不收的 STATISTICS/SIMPLE，
    // `BuildTreeConsoleView.java:664`）。不删行：`src/bridge.ts:667` 收进来就是收到了，
    // 悄悄丢掉才是骗人；只把它压成不显眼的灰。
    case 'telemetry': return 4
    default: return CONSOLE_SEVERITY
  }
}

/** 这一行的呈现档（颜色那一轴，与严重度分开：`console` 与 `stdout` 同严重度但不同呈现）。 */
export function dapOutputPresentationOf(category: unknown): DapOutputPresentation {
  switch (normalize(category)) {
    case 'stderr': return 'error'
    case 'important': return 'warning'
    case 'stdout':
    case 'output': return 'normal'
    case 'console': return 'system'
    case 'telemetry': return 'muted'
    default: return 'system'
  }
}

/**
 * 画在行上的类名：`sev-<呈现档>`。
 * **不再**把适配器给的原始 `category` 当类名 —— 那是「恰好撞上一条 CSS 才算分档」的形状，
 * 适配器自造一个名字（`build`/`trace`/`server`…）就会掉进无样式的默认色，界面看着像「全塌成一级」，
 * 而类名里还带着那个陌生词，谁都看不出它算不算错误。
 * `dapOutputAttention` 留在类名上，让样式与判据都能按「这一行要不要用户看一眼」这一轴问。
 */
export function dapOutputLineClass(category: unknown): string {
  const presentation = dapOutputPresentationOf(category)
  const severity = dapOutputSeverityOf(category)
  return `sev-${presentation}${severity <= DAP_OUTPUT_ATTENTION_MAX_SEVERITY ? ' sev-attention' : ''}`
}

/** 这一行要不要用户看一眼（与 `src/lspServerMessages.ts` 的 `handleLogMessage` 同一条 `severity <= 2`）。 */
export function dapOutputNeedsAttention(category: unknown): boolean {
  return dapOutputSeverityOf(category) <= DAP_OUTPUT_ATTENTION_MAX_SEVERITY
}

export interface DapOutputAttention {
  error: number
  warning: number
  /** 四档各自的条数（索引 1..4；0 位不用，留个 0 占位免得下标错位）。 */
  bySeverity: [number, number, number, number, number]
}

/**
 * 控制台里「要用户看一眼」的那两档各有几条 —— 标题栏那一格读它。
 * 数的是**当前还在表里的行**（`src/bridge.ts:668` 会把超上限的前半截裁掉，裁掉的就不再是
 * 「用户能点到的那些」，所以这里不另存一份累计数）。
 */
export function countDapOutputAttention(lines: readonly DapOutputLine[]): DapOutputAttention {
  const bySeverity: [number, number, number, number, number] = [0, 0, 0, 0, 0]
  for (const line of lines) bySeverity[dapOutputSeverityOf(line.category)] += 1
  return { error: bySeverity[1] ?? 0, warning: bySeverity[2] ?? 0, bySeverity }
}
