// 运行控制台的 **ANSI 色码解码**（上游 `AnsiEscapeDecoder` + `AnsiTerminalEmulator` 那一族）。
//
// 为什么这是用户可见的缺口：本仓的运行/构建输出走的是**管道**，宿主不剥 ANSI
// （`native/run_host.cpp` 原样回传 stdout 字节、`src/runInstances.ts` 只管按控制台编码解码字符），
// 所以 `cargo`/`npm`/`pytest`/`javac` 这类带色输出（`--color=always`、`FORCE_COLOR`、CI 环境）
// 在控制台里就是一行行转义垃圾。上游同一份输出是**有色**的：
//   · Java 应用运行用的就是「彩色」处理器 ——
//     `java/execution/openapi/src/com/intellij/execution/configurations/JavaCommandLineStateUtil.java:17-21`
//     （`ansiColoring` 为真时走 `createColoredProcessHandler`，实现见
//     `platform/platform-impl/src/com/intellij/execution/process/ProcessHandlerFactoryImpl.java:16-17`）；
//     另两处同样直接建彩色处理器：`platform/lang-impl/src/com/intellij/tools/ToolRunProfile.java:97`、
//     `platform/lang-impl/src/com/intellij/ide/actions/runAnything/execution/RunAnythingRunProfileState.java:55`；
//     构建控制台自己再解一遍：`platform/lang-impl/src/com/intellij/build/BuildTextConsoleView.java`、
//     `platform/buildView/frontend/src/FrontendMultipleBuildsView.kt`。
//   · 解码器 `platform/platform-util-io/src/com/intellij/execution/process/AnsiEscapeDecoder.java`：
//     **每条流一套词法器 + 一套终端状态机**（`:20-23`，stdout/stderr 各一份 ⇒ 颜色跨块延续），
//     元素只有三类 —— SGR 改状态、TEXT 带着「当前属性」往下发、其余 CONTROL **忽略**（`:66-75`）；
//     既不是 stdout 也不是 stderr 的流（system）**根本不解 ANSI**（`:50-52`）；
//     状态机还在初始态时，输出属性**就是流本身的属性**（`:112-120`）—— 本仓据此对没有任何样式的
//     行完全不产生片段（渲染零变化）。
//   · 词法器 `platform/platform-util-io/src/com/intellij/execution/process/AnsiStreamingLexer.java`：
//     `ESC [` = CSI，参数字节 0x30-0x3F + 中间字节 0x20-0x2F + 终结字节 0x40-0x7E（`:112-142`）；
//     终结字节 `m` = SGR、其余终结字节 = CONTROL、**不成形的整段当文本**（`:132-141`）；
//     `ESC =`/`ESC >` 也是 CONTROL（`:155-164`）；**其它 ESC（含 OSC `ESC ]`）上游不当它是转义序列**，
//     原样留在文本里（`decodeEscapeSequence()` 走 `:165-167` 的 default 返回 false，调用方 `:105-109`
//     落回 `advanceToEscape()`，文本段见 `:171-175`）；
//     块尾没读完的序列**留着等下一块**（`:177-180` 的 `incompleteSequence`）。
//   · 状态机 `platform/platform-util-io/src/com/intellij/execution/process/AnsiTerminalEmulator.java`：
//     SGR 体里出现 `:` 就用 `:` 切、否则用 `;`（`:122`）、空段当 0（`:126`）、
//     解不出整数就**停止处理这一串**（`:128-131` 与 `:136-138`）；命令表 `:147-211`；
//     颜色编码 `:396-434`：`5;n` 里 0-15 是「可配置色」、16-255 按 6×6×6 色立方与灰阶算成真色
//     （`CUBE_STEPS = {0x0,0x5f,0x87,0xaf,0xd7,0xff}`，`:647-652`），`2;r;g;b` 直接 RGB
//     （`RGBColor` 在 `:530` 起、它的 `getColor()` 在 `:553`），越界返回 null ⇒ 等于没设色；
//     `reset`（码 0）抹掉全部状态（`:278-293`）；未知命令**只记日志、不改状态、继续下一条**（`:204-206`）。
//   · 状态到颜色 `platform/platform-api/src/com/intellij/execution/process/ColoredOutputTypeRegistryImpl.java`：
//     0-15 走配色方案的 ANSI 键表（`:34-51`），`getAnsiColorKey` 对 `>=16` 才退回 `NORMAL_OUTPUT_KEY`
//     （`:160-165`），但 16-255 在上游带的是**算出来的 RGB**，取色时强制色优先（`:314-318`）
//     ⇒ 256 色在控制台里同样是真色；反色 = 前景背景互换（`:299-303`）；
//     下划线 4→LINE_UNDERSCORE、21→BOLD_LINE_UNDERSCORE、9→STRIKEOUT（`:247-256`）；
//     字体只认**粗体与斜体**（`:269-278` 的 `computeAwtFont` —— `FAINT` 进了状态机但控制台侧不画，
//     本仓照此不画，见 `CONSOLE_ANSI_NOT_RENDERED`）。
//
// 本仓落点：`src/runIssues.ts` 的 `runLines`（每行先过这里：先剥转义、再折叠与识别问题/链接）与
// `src/components/RunConsole.vue`（按片段上色）。调色板**复用** `src/terminalColors.ts`
// （同一套 16 色与色立方/灰阶算法，不在这里再写一张表）。颜色串在渲染时才解析成 CSS，
// 所以切主题不必等新输出就能看到新配色（与终端面板同一口径）。
// 与架构不等价的三处（如实记，不假装等价）：
//   · 上游给 stdout 与 stderr **各一台**状态机（`AnsiEscapeDecoder.java:20-23`），本仓宿主只回传一条
//     输出通道（`run.output` 不分流，见 `src/runInstances.ts` 的 `handleRunOutput`）⇒ 一台状态机按行喂；
//   · 上游按行重放的起点是「进程起跑」，本仓是「每次重算从当前缓冲开头重放」——缓冲被
//     `RUN_OUTPUT_LIMIT` 截头时，被截掉那部分留下的样式不追（只是最老几行的颜色回默认，不改文本）；
//   · 上游把属性折成 `ConsoleViewContentType` 交给编辑器分层着色，
//     本仓一行是一串 DOM 片段 ⇒ 一个片段一种样式；点击/跳转的链接片段按**片段起点**的样式上色
//     （见 `consoleAnsiStyleAt`）。
// 判据：tests/console-ansi.test.mjs。

import { colorByAnsiIndex, getBackgroundByColorIndex, getForegroundByColorIndex, type TerminalColorPalette } from './terminalColors.ts'

// 上游 `AnsiStreamingLexer.java:15` 的 `ESCAPE`（码点 0x1b）、`:16` 的 `CSI = ESC + "["`、
// `:17` 的 `SGR_SUFFIX = 'm'`。
const ESCAPE = String.fromCharCode(0x1b)
const CSI = ESCAPE + '['

/** ANSI 颜色的两种来源：调色板色号（0-15 可配置色、16-255 色立方/灰阶）或直接 RGB。 */
export type ConsoleAnsiColor = { kind: 'index'; index: number } | { kind: 'rgb'; red: number; green: number; blue: number }

/** 上游 `Underline` 的三档（`AnsiTerminalEmulator.java:153/161/171`）。 */
export type ConsoleAnsiUnderline = 'none' | 'single' | 'double'

/** `AnsiTerminalEmulator` 的可见状态里，本仓会画出来的那部分（其余见 `CONSOLE_ANSI_NOT_RENDERED`）。 */
export interface ConsoleAnsiStyle {
  foreground: ConsoleAnsiColor | null
  background: ConsoleAnsiColor | null
  bold: boolean
  /** 进了状态（码 2、`22` 关）但上游控制台侧不画（`computeAwtFont` 只看 BOLD/ITALIC）。 */
  faint: boolean
  italic: boolean
  underline: ConsoleAnsiUnderline
  inverse: boolean
  crossedOut: boolean
}

/** 一段同样式的文本；`start`/`end` 是**剥掉转义之后**的行内偏移。 */
export interface ConsoleAnsiChunk {
  text: string
  start: number
  end: number
  style: ConsoleAnsiStyle
}

export interface ConsoleAnsiLine {
  /** 去掉转义序列后的可见文本（问题/链接识别与折叠都用它）。 */
  text: string
  /** 有样式的片段；整行没有任何样式时是**空表**（面板走原渲染，零变化）。 */
  chunks: ConsoleAnsiChunk[]
}

export interface ConsoleAnsiDecoder {
  /** 解一行（上游是按块解，本仓按行喂；状态跨行延续，见文件头）。 */
  line(raw: string): ConsoleAnsiLine
  /** 当前状态（等价上游 `isInitialState` 的判据来源）。 */
  style(): ConsoleAnsiStyle
  reset(): void
}

/** 上游 `EMPTY_EMULATOR`（`AnsiTerminalEmulator.java:90`）的等价物：全空。 */
export const CONSOLE_ANSI_INITIAL_STYLE: ConsoleAnsiStyle = Object.freeze({
  foreground: null, background: null, bold: false, faint: false,
  italic: false, underline: 'none' as ConsoleAnsiUnderline, inverse: false, crossedOut: false,
})

/** 状态是否还在初始态（上游 `isInitialState`，`AnsiTerminalEmulator.java:299-301`）。 */
export function isInitialConsoleAnsiStyle(style: ConsoleAnsiStyle): boolean {
  return style.foreground === null && style.background === null && !style.bold && !style.faint
    && !style.italic && style.underline === 'none' && !style.inverse && !style.crossedOut
}

/**
 * 上游登记了、本仓**不画**的 SGR 状态（不放假样式：画不出来的就不假装支持，逐条给理由）。
 * 导出来是为了让这条决定可被门禁核对，而不是只写在注释里。
 */
export const CONSOLE_ANSI_NOT_RENDERED = [
  {
    code: '5 / 6（闪）与 25（关闪）',
    reason: '上游只是 `BlinkSpeed` 状态（`AnsiTerminalEmulator.java:154-155/172`），`computeAwtFont` 与 '
      + '`computeEffectTypes` 都不看它（`ColoredOutputTypeRegistryImpl.java:269-278/247-256`）⇒ 控制台本来就不闪。',
  },
  {
    code: '2（暗 / FAINT）与 22',
    reason: '状态机记 FAINT，但字体计算只认 BOLD 与 ITALIC（`ColoredOutputTypeRegistryImpl.java:269-278`）⇒ 不画。',
  },
  {
    code: '8（隐藏）与 28（显形）',
    reason: '`myIsConseal` 只进状态（`AnsiTerminalEmulator.java:157/174`），上面那两个计算函数都不消费 ⇒ 不画。',
  },
  {
    code: '10-20（字体族 / 哥特）',
    reason: '上游映射成 `Font` 族名/`Font.ITALIC`（`AnsiTerminalEmulator.java:159/160/186-188`）；'
      + '本仓控制台是等宽字体，没有对应的字体族族名，加进去就是自造样式。',
  },
  {
    code: '51 / 52 / 53 / 54 / 55（边框、圈、上划线）',
    reason: '`EffectType.BOXED`/`ROUNDED_BOX`（`AnsiTerminalEmulator.java:436-440` 起的 `FrameType`）—— '
      + '编辑器侧是绘制效果，控制台 DOM 片段上没有对应样式，且上游 `BOXED` 只在编辑器绘制里可见。',
  },
  {
    code: '60-65（表意文字下标）',
    reason: '上游本身也是 no-op，只写了条调试日志（`AnsiTerminalEmulator.java:195-197`）。',
  },
] as const

/** 上游 `AnsiStreamingLexer.java:186-188` 的 `isInRange`（含端点）。 */
function inRange(char: string, start: number, end: number): boolean {
  const code = char.charCodeAt(0)
  return code >= start && code <= end
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value))
}

/**
 * `AnsiTerminalEmulator.decode8BitColor`（`:424-434`）：0-15 = 可配置色，16-255 = 色立方/灰阶（仍是索引，
 * 由 `colorByAnsiIndex` 现算），越界 = null（等于没设色）。
 */
function decodeIndexedColor(index: number): ConsoleAnsiColor | null {
  if (index >= 0 && index <= 15) return { kind: 'index', index }
  if (index >= 16 && index <= 255) return { kind: 'index', index }
  return null
}

/**
 * `AnsiTerminalEmulator.decodeColor`（`:396-417`）：`5;n` 走索引、`2;r;g;b` 走 RGB，
 * 参数不够就返回 null（上游也是直接 `return null`）。
 * 返回「读掉的最后一个下标」，与上游用同一个迭代器消费参数的写法等价。
 */
function readEncodedColor(tokens: string[], at: number): { color: ConsoleAnsiColor | null; next: number } {
  const encoding = parseCode(tokens[at])
  if (encoding === null) return { color: null, next: at }
  if (encoding === 2) {
    const red = parseCode(tokens[at + 1])
    const green = parseCode(tokens[at + 2])
    const blue = parseCode(tokens[at + 3])
    if (red === null || green === null || blue === null) return { color: null, next: at + 1 }
    // 上游 `RGBColor.getColor()` 直接 `new Color(r,g,b)`；本仓多一道夹取，免得越界值把样式写成非法串。
    return { color: { kind: 'rgb', red: clampByte(red), green: clampByte(green), blue: clampByte(blue) }, next: at + 3 }
  }
  if (encoding === 5) {
    const index = parseCode(tokens[at + 1])
    if (index === null) return { color: null, next: at + 1 }
    return { color: decodeIndexedColor(index), next: at + 1 }
  }
  return { color: null, next: at }
}

/** 上游 `Integer.parseInt`：空串在外面先当 0（`AnsiTerminalEmulator.java:126`），带别的字符一律算解析失败。 */
function parseCode(token: string | undefined): number | null {
  if (token === undefined || token.length === 0) return null
  if (!/^-?\d+$/.test(token)) return null
  return Number.parseInt(token, 10)
}

/**
 * 一台终端状态机（上游 `AnsiTerminalEmulator` 的本仓等价物）+ 一段文本的切分。
 * 状态跨行延续：`createConsoleAnsiDecoder()` 建一个，按顺序把行喂进去。
 */
export function createConsoleAnsiDecoder(): ConsoleAnsiDecoder {
  let state: ConsoleAnsiStyle = { ...CONSOLE_ANSI_INITIAL_STYLE }
  // 上游 `incompleteSequence`（`AnsiStreamingLexer.java:177-180`）：没读完的序列留给下一块。
  let pending = ''

  /** `AnsiTerminalEmulator.processSgr`（`:116-141` + `:147-211`）。 */
  function applySgr(body: string): void {
    const separator = body.includes(':') ? ':' : ';'
    const tokens = body.split(separator)
    for (let index = 0; index < tokens.length; ++index) {
      const token = tokens[index]!
      const code = token.length === 0 ? 0 : parseCode(token)
      // 上游：空段当 0；解不出整数就**整串停止**（`:128-131` 记日志、`:136-138` break）。
      if (code === null) break
      index = applyCode(code, tokens, index)
    }
  }

  /** 单条 SGR 命令；返回消费到的最后一个下标（38/48 要多吃几个参数）。 */
  function applyCode(code: number, tokens: string[], index: number): number {
    switch (code) {
      case 0: state = { ...CONSOLE_ANSI_INITIAL_STYLE }; return index        // :149 重置
      case 1: state = { ...state, bold: true }; return index                 // :150
      case 2: state = { ...state, faint: true }; return index                // :151
      case 3: state = { ...state, italic: true }; return index               // :152
      case 4: state = { ...state, underline: 'single' }; return index        // :153
      case 7: state = { ...state, inverse: true }; return index              // :156
      case 9: state = { ...state, crossedOut: true }; return index           // :158
      case 21: state = { ...state, bold: false, faint: false, underline: 'double' }; return index  // :161-165
      case 22: state = { ...state, bold: false, faint: false }; return index // :166
      case 23: state = { ...state, italic: false }; return index             // :167-170
      case 24: state = { ...state, underline: 'none' }; return index         // :171
      case 27: state = { ...state, inverse: false }; return index            // :173
      case 29: state = { ...state, crossedOut: false }; return index         // :175
      case 38: return readColor(tokens, index, 'foreground')                 // :176
      case 39: state = { ...state, foreground: null }; return index          // :177
      case 48: return readColor(tokens, index, 'background')                 // :178
      case 49: state = { ...state, background: null }; return index          // :179
      case 5: case 6: case 8: case 25: case 28: return index                 // 见 CONSOLE_ANSI_NOT_RENDERED
      case 20: return index                                                  // FRAKTUR：本仓不画字体族
      default: break
    }
    if (code >= 10 && code <= 19) return index                               // 字体族：不画
    // :189-194 基本色 30-37 / 40-47；:198-203 亮色 90-97 / 100-107（映射成 8-15）。
    if (code >= 30 && code <= 37) { state = { ...state, foreground: { kind: 'index', index: code - 30 } }; return index }
    if (code >= 40 && code <= 47) { state = { ...state, background: { kind: 'index', index: code - 40 } }; return index }
    if (code >= 90 && code <= 97) { state = { ...state, foreground: { kind: 'index', index: code - 82 } }; return index }
    if (code >= 100 && code <= 107) { state = { ...state, background: { kind: 'index', index: code - 92 } }; return index }
    if (code >= 51 && code <= 55) return index                               // 边框/圈/上划线：不画
    if (code >= 60 && code <= 65) return index                               // :195-197 上游也是 no-op
    // :204-206 未知命令：只记日志，状态不动，继续下一条。
    return index
  }

  function readColor(tokens: string[], index: number, role: 'foreground' | 'background'): number {
    const { color, next } = readEncodedColor(tokens, index + 1)
    state = role === 'foreground' ? { ...state, foreground: color } : { ...state, background: color }
    return next
  }

  return {
    line(raw: string): ConsoleAnsiLine {
      const source = pending + raw
      pending = ''
      const pieces: ConsoleAnsiChunk[] = []
      let text = ''
      // 当前片段用的状态快照；状态一变就置空，下一段文本重新取快照（同状态的多段会并成一片）。
      let current: ConsoleAnsiStyle | null = null
      const append = (part: string) => {
        if (part.length === 0) return
        current ??= { ...state }
        const start = text.length
        text += part
        const last = pieces.length > 0 ? pieces[pieces.length - 1]! : null
        if (last !== null && last.style === current) { last.text += part; last.end = text.length }
        else pieces.push({ text: part, start, end: text.length, style: current })
      }

      let cursor = 0
      while (cursor < source.length) {
        if (source[cursor] !== ESCAPE) {
          const next = source.indexOf(ESCAPE, cursor)
          const part = next === -1 ? source.slice(cursor) : source.slice(cursor, next)
          append(part)
          cursor += part.length
          continue
        }
        if (cursor + 1 >= source.length) { pending = source.slice(cursor); break }
        const marker = source[cursor + 1]!
        if (marker === '[') {
          let scan = cursor + CSI.length
          while (scan < source.length && inRange(source[scan]!, 0x30, 0x3f)) ++scan
          while (scan < source.length && inRange(source[scan]!, 0x20, 0x2f)) ++scan
          if (scan >= source.length) { pending = source.slice(cursor); break }
          const final = source[scan]!
          if (inRange(final, 0x40, 0x7e)) {
            if (final === 'm') { applySgr(source.slice(cursor + CSI.length, scan)); current = null }
            cursor = scan + 1
            continue
          }
          // 不成形的 CSI 整段当文本（`AnsiStreamingLexer.java:138-141`）。
          const breakAt = source.indexOf(ESCAPE, cursor + 1)
          const part = breakAt === -1 ? source.slice(cursor) : source.slice(cursor, breakAt)
          append(part)
          cursor += part.length
          continue
        }
        if (marker === '=' || marker === '>') { cursor += 2; continue }        // :155-164 CONTROL
        // 其它 ESC 序列（含 OSC `ESC ]`）上游不当转义序列 ⇒ 原样留作文本（:105-109 与 :165-167）。
        const breakAt = source.indexOf(ESCAPE, cursor + 1)
        const part = breakAt === -1 ? source.slice(cursor) : source.slice(cursor, breakAt)
        append(part)
        cursor += part.length
      }

      const styled = pieces.some(piece => !isInitialConsoleAnsiStyle(piece.style))
      return { text, chunks: styled ? pieces : [] }
    },
    style(): ConsoleAnsiStyle { return { ...state } },
    reset(): void { state = { ...CONSOLE_ANSI_INITIAL_STYLE }; pending = '' },
  }
}

/** 色号/RGB → 颜色串。`role` 决定 0-15 那批走前景表还是背景表（上游同一张键表，取的是对应属性）。 */
export function consoleAnsiColorCss(color: ConsoleAnsiColor, palette: TerminalColorPalette, role: 'foreground' | 'background'): string {
  if (color.kind === 'rgb') {
    const hex = (value: number) => value.toString(16).padStart(2, '0')
    return `#${hex(color.red)}${hex(color.green)}${hex(color.blue)}`
  }
  if (color.index < 16) {
    return role === 'foreground'
      ? getForegroundByColorIndex(palette, color.index)
      : getBackgroundByColorIndex(palette, color.index)
  }
  return colorByAnsiIndex(palette, color.index)
}

/**
 * 样式 → 内联 CSS。初始态返回**空表**：那一行的颜色仍由控制台自己的 stdout/stderr 样式决定
 * （上游同一件事：`AnsiEscapeDecoder.java:112-120` 初始态直接用流本身的属性）。
 * 反色按上游互换前景背景，缺的那一侧取调色板的默认色（`ColoredOutputTypeRegistryImpl.java:299-303`）。
 */
export function consoleAnsiCss(style: ConsoleAnsiStyle, palette: TerminalColorPalette): Record<string, string> {
  const css: Record<string, string> = {}
  const foreground = style.foreground === null ? null : consoleAnsiColorCss(style.foreground, palette, 'foreground')
  const background = style.background === null ? null : consoleAnsiColorCss(style.background, palette, 'background')
  if (style.inverse) {
    css.color = background ?? palette.defaultBackground
    css['background-color'] = foreground ?? palette.defaultForeground
  }
  else {
    if (foreground !== null) css.color = foreground
    if (background !== null) css['background-color'] = background
  }
  if (style.bold) css['font-weight'] = 'bold'
  if (style.italic) css['font-style'] = 'italic'
  const decorations: string[] = []
  if (style.underline === 'single') decorations.push('underline')
  if (style.underline === 'double') decorations.push('underline double')
  if (style.crossedOut) decorations.push('line-through')
  if (decorations.length > 0) css['text-decoration'] = decorations.join(' ')
  return css
}

/**
 * 偏移处生效的样式（面板给可点击片段上色用：一个片段一种样式，取片段起点）。
 * 片段表为空 ⇒ 返回 null（整行没有样式）。
 */
export function consoleAnsiStyleAt(chunks: readonly ConsoleAnsiChunk[], offset: number): ConsoleAnsiStyle | null {
  for (const chunk of chunks) {
    if (offset >= chunk.start && offset < chunk.end) return chunk.style
  }
  return chunks.length > 0 ? chunks[chunks.length - 1]!.style : null
}
