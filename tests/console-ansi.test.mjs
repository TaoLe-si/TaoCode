// 运行控制台的 ANSI 解码（`src/consoleAnsi.ts`，上游 `AnsiEscapeDecoder` + `AnsiStreamingLexer` +
// `AnsiTerminalEmulator` + `ColoredOutputTypeRegistryImpl` 那一族）。
// 每条断言旁边写的都是上游行号，方便核对「本仓这一条是在复刻哪一句」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  CONSOLE_ANSI_INITIAL_STYLE, CONSOLE_ANSI_NOT_RENDERED, consoleAnsiCss, consoleAnsiStyleAt,
  createConsoleAnsiDecoder, isInitialConsoleAnsiStyle,
} from '../src/consoleAnsi.ts'
import { terminalPalette } from '../src/terminalColors.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const ESC = String.fromCharCode(0x1b)
const sgr = body => `${ESC}[${body}m`

/** 按顺序把若干行喂给同一台状态机（上游就是 per-stream 一套状态，颜色跨行延续）。 */
function feed(...lines) {
  const decoder = createConsoleAnsiDecoder()
  return { decoder, out: lines.map(line => decoder.line(line)) }
}

// 深色调色板（`terminalPalette('dark', 前景, 背景)`）：16 色取 `ANSI_DARK_COLORS`，
// 1 号位红是 `#cd0000`，反色缺的那一侧才退回默认前/背景。
const dark = terminalPalette('dark', '#d0d0d0', '#101010')

test('31 那一档：转义剥掉、文本留下、前景是 1 号色', () => {
  const { out } = feed(`${sgr('31')}error${sgr('0')}`)
  assert.equal(out[0].text, 'error', '可见文本里没有 ESC')
  assert.equal(out[0].chunks.length, 1)
  assert.deepEqual(out[0].chunks[0].style.foreground, { kind: 'index', index: 1 })
  assert.equal(consoleAnsiCss(out[0].chunks[0].style, dark).color, '#cd0000')
})

test('一行里的颜色分段：每段都带属性，包括没设色的那两段', () => {
  const { out } = feed(`a${sgr('32')}b${sgr('0')}c`)
  const chunks = out[0].chunks
  assert.deepEqual(chunks.map(chunk => chunk.text), ['a', 'b', 'c'], '片段拼回去必须是整行')
  assert.deepEqual(chunks.map(chunk => `${chunk.start}-${chunk.end}`), ['0-1', '1-2', '2-3'])
  assert.ok(isInitialConsoleAnsiStyle(chunks[0].style), '开头那段还在初始态')
  assert.deepEqual(chunks[1].style.foreground, { kind: 'index', index: 2 })
  assert.ok(isInitialConsoleAnsiStyle(chunks[2].style))
})

test('状态跨行延续，直到 ESC[0m（AnsiEscapeDecoder.java:20-23 的 per-stream 状态机）', () => {
  const { out } = feed(`${sgr('31')}red`, 'still red', `${sgr('0')}plain`)
  assert.equal(out[0].chunks[0].style.foreground.index, 1)
  assert.equal(out[1].text, 'still red')
  assert.deepEqual(out[1].chunks[0].style.foreground, { kind: 'index', index: 1 }, '下一行仍是红的')
  assert.deepEqual(out[2].chunks, [], '重置之后整行没有样式 ⇒ 不产生片段（面板渲染路径不变）')
})

test('没有任何色码的一行不产生片段（AnsiEscapeDecoder.java:112-120 的初始态）', () => {
  const { decoder, out } = feed('普通输出')
  assert.deepEqual(out[0], { text: '普通输出', chunks: [] })
  assert.ok(isInitialConsoleAnsiStyle(decoder.style()))
  assert.ok(isInitialConsoleAnsiStyle(CONSOLE_ANSI_INITIAL_STYLE))
})

test('90-97 / 100-107 映射成 8-15（AnsiTerminalEmulator.java:198-203）', () => {
  const { out } = feed(`${sgr('90')}dim red`)
  assert.deepEqual(out[0].chunks[0].style.foreground, { kind: 'index', index: 8 })
  assert.equal(consoleAnsiCss(out[0].chunks[0].style, dark).color, '#7f7f7f')
  const { out: bg } = feed(`${sgr('101')}x`)
  assert.deepEqual(bg[0].chunks[0].style.background, { kind: 'index', index: 9 })
})

test('38;5;n：0-15 走调色板，16-231 是色立方，232-255 是灰阶（AnsiTerminalEmulator.java:424-434）', () => {
  const { out } = feed(`${sgr('38;5;196')}cube`)
  assert.deepEqual(out[0].chunks[0].style.foreground, { kind: 'index', index: 196 })
  // 196 - 16 = 180 → r=5、g=0、b=0 → CUBE_STEPS 的 {0xff,0x00,0x00}
  assert.equal(consoleAnsiCss(out[0].chunks[0].style, dark).color, '#ff0000')
  const { out: gray } = feed(`${sgr('38;5;232')}gray`)
  assert.equal(consoleAnsiCss(gray[0].chunks[0].style, dark).color, '#080808')
})

test('38;5;n 越界与 38 缺参数：等于没设色（decodeColor/decode8BitColor 的 return null）', () => {
  const { out } = feed(`${sgr('38;5;300')}none`, `${sgr('38')}also none`)
  assert.deepEqual(out[0].chunks, [], '300 越界 ⇒ 前景为 null ⇒ 整行仍是初始态')
  assert.equal(out[0].text, 'none')
  assert.deepEqual(out[1].chunks, [])
})

test('38;2;r;g;b 直接 RGB（AnsiTerminalEmulator.java:401-407）', () => {
  const { out } = feed(`${sgr('38;2;18;52;86')}rgb`)
  assert.deepEqual(out[0].chunks[0].style.foreground, { kind: 'rgb', red: 18, green: 52, blue: 86 })
  assert.equal(consoleAnsiCss(out[0].chunks[0].style, dark).color, '#123456')
})

test('SGR 体里出现冒号就按冒号切（AnsiTerminalEmulator.java:122）', () => {
  const { out } = feed(`${sgr('38:5:196')}colon`)
  assert.deepEqual(out[0].chunks[0].style.foreground, { kind: 'index', index: 196 })
})

test('空参数段当 0：先重置再上色（AnsiTerminalEmulator.java:126）', () => {
  const { out } = feed(`${sgr('32')}kept${ESC}[;31mred`)
  const chunks = out[0].chunks
  assert.deepEqual(out[0].text, 'keptred')
  assert.deepEqual(chunks.map(chunk => chunk.style.foreground), [
    { kind: 'index', index: 2 }, { kind: 'index', index: 1 },
  ])
})

test('解不出整数就停止整串，后面的命令不再吃（AnsiTerminalEmulator.java:128-131 与 :136-138）', () => {
  // `=` 是 CSI 的**参数字节**（0x30-0x3F），所以这条能进到 SGR 体里，正文才谈得上「解析失败」。
  const { out } = feed(`${ESC}[31;=;42mtext`)
  const style = out[0].chunks[0].style
  assert.deepEqual(style.foreground, { kind: 'index', index: 1 }, '31 已经生效')
  assert.equal(style.background, null, '= 之后的 42 不该再生效')
})

test('参数字节范围之外的字符就是终结字节：整条算 CONTROL，颜色一律不生效（AnsiStreamingLexer.java:120-141）', () => {
  const { out } = feed(`${ESC}[31;xx;42mtext`)
  assert.equal(out[0].text, 'x;42mtext', '第一个 x 就是这条 CSI 的终结字节，它之后的都算正文')
  assert.deepEqual(out[0].chunks, [], 'CONTROL 不改状态（AnsiEscapeDecoder.java:72-75）')
})

test('未知命令只跳过这一条，状态继续（AnsiTerminalEmulator.java:204-206）', () => {
  const { out } = feed(`${ESC}[42;999;31mtext`)
  const style = out[0].chunks[0].style
  assert.deepEqual(style.background, { kind: 'index', index: 2 })
  assert.deepEqual(style.foreground, { kind: 'index', index: 1 })
})

test('非 SGR 的 CSI 被吞掉、不改颜色（AnsiEscapeDecoder.java:72-75 的 CONTROL 分支）', () => {
  const { out } = feed(`a${ESC}[2K${ESC}[1;1Hb`)
  assert.equal(out[0].text, 'ab', '清行与光标移动都不该留在文本里')
  assert.deepEqual(out[0].chunks, [])
})

test('不成形的 CSI 整段当文本（AnsiStreamingLexer.java:138-141）', () => {
  const { out } = feed(`a${ESC}[9\tb`)
  assert.equal(out[0].text, `a${ESC}[9\tb`, '终结字节不在 0x40-0x7E 里就不是转义序列')
})

test('块尾没读完的序列留给下一块（AnsiStreamingLexer.java:177-180 的 incompleteSequence）', () => {
  const { out } = feed(`${ESC}[3`, '1mred')
  assert.equal(out[0].text, '', '这一行只剩一个没读完的序列 ⇒ 没有可见文本')
  assert.equal(out[1].text, 'red')
  assert.deepEqual(out[1].chunks[0].style.foreground, { kind: 'index', index: 1 })
})

test('其它 ESC（含 OSC）上游不当它是转义序列 ⇒ 原样留在文本（AnsiStreamingLexer.java:105-109）', () => {
  const { out } = feed(`a${ESC}]0;title${ESC}\\b`)
  assert.ok(out[0].text.includes(ESC), '本仓不自己发明 OSC 剥离规则')
})

test('样式 → CSS：初始态是空表，反色互换前景背景（ColoredOutputTypeRegistryImpl.java:299-303）', () => {
  assert.deepEqual(consoleAnsiCss(CONSOLE_ANSI_INITIAL_STYLE, dark), {}, '没样式就不写内联样式')
  const inverse = { ...CONSOLE_ANSI_INITIAL_STYLE, inverse: true, foreground: { kind: 'index', index: 1 } }
  const css = consoleAnsiCss(inverse, dark)
  assert.equal(css.color, '#101010', '反色的文字取的是背景那一侧（这里没设背景 ⇒ 默认背景）')
  assert.equal(css['background-color'], '#cd0000')
})

test('字重 / 斜体 / 下划线 / 删除线；21 是双下划线并清字重（emulator :161-165 与 registry :247-256）', () => {
  const bold = consoleAnsiCss({ ...CONSOLE_ANSI_INITIAL_STYLE, bold: true }, dark)
  assert.equal(bold['font-weight'], 'bold')
  const both = consoleAnsiCss({ ...CONSOLE_ANSI_INITIAL_STYLE, underline: 'single', crossedOut: true }, dark)
  assert.equal(both['text-decoration'], 'underline line-through')
  const { out } = feed(`${sgr('1;21')}x`)
  const style = out[0].chunks[0].style
  assert.equal(style.bold, false, 'ECMA-48：21 先清字重（上游那条注释也写着）')
  assert.equal(style.underline, 'double')
  assert.equal(consoleAnsiCss(style, dark)['text-decoration'], 'underline double')
})

test('FAINT / 闪 / 隐藏 / 字体族 / 边框都只进状态不画（computeAwtFont 只看 BOLD 与 ITALIC）', () => {
  const { out } = feed(`${sgr('2;5;8;12;51;60')}x`)
  const style = out[0].chunks[0].style
  assert.equal(style.faint, true, '状态机仍记 FAINT')
  assert.deepEqual(consoleAnsiCss(style, dark), {}, '但控制台侧不产生任何样式')
})

test('consoleAnsiStyleAt：按偏移取生效样式，空表返回 null', () => {
  const { out } = feed(`a${sgr('32')}b${sgr('31')}c`)
  const chunks = out[0].chunks
  assert.equal(consoleAnsiStyleAt(chunks, 0), chunks[0].style)
  assert.equal(consoleAnsiStyleAt(chunks, 1), chunks[1].style)
  assert.equal(consoleAnsiStyleAt(chunks, 2), chunks[2].style)
  assert.equal(consoleAnsiStyleAt(chunks, 99), chunks[chunks.length - 1].style, '越界落到最后一段')
  assert.equal(consoleAnsiStyleAt([], 0), null)
})

test('登记「上游有、本仓不画」的那几档，每条都带上游坐标', () => {
  const ids = CONSOLE_ANSI_NOT_RENDERED.map(entry => entry.code)
  assert.deepEqual(ids, [
    '5 / 6（闪）与 25（关闪）', '2（暗 / FAINT）与 22', '8（隐藏）与 28（显形）',
    '10-20（字体族 / 哥特）', '51 / 52 / 53 / 54 / 55（边框、圈、上划线）', '60-65（表意文字下标）',
  ])
  for (const entry of CONSOLE_ANSI_NOT_RENDERED) {
    assert.match(entry.reason, /AnsiTerminalEmulator\.java|ColoredOutputTypeRegistryImpl\.java/,
      `${entry.code} 的理由要引得到上游行号`)
  }
})

test('消费链：行样式在 runIssues 里就挂上，面板按片段上色', () => {
  const issues = read('src/runIssues.ts')
  assert.match(issues, /import \{ createConsoleAnsiDecoder \} from '\.\/consoleAnsi\.ts'/)
  assert.match(issues, /const ansi = createConsoleAnsiDecoder\(\)/)
  assert.match(issues, /const \{ text, chunks \} = ansi\.line\(raw\)/)
  assert.match(issues, /\.\.\.\(chunks\.length > 0 \? \{ chunks \} : \{\}\)/,
    '没样式的行不带这个字段 ⇒ 渲染路径零变化')
  assert.match(issues, /findRunHyperlinks\(text/, '链接识别吃的是**剥完转义**的文本')

  const panel = read('src/components/RunConsole.vue')
  assert.match(panel, /import \{ consoleAnsiCss, consoleAnsiStyleAt, type ConsoleAnsiChunk \} from '\.\.\/consoleAnsi\.ts'/)
  assert.match(panel, /const pieces: RenderedSegment\[\] = segments\.map/, '链接片段按起点取样式')
  assert.match(panel, /v-for="\(chunk, chunkIndex\) in line\.chunks"/, '纯文本行走逐片段上色那一条分支')
  assert.match(panel, /:style="consoleAnsiCss\(chunk\.style, consolePalette\)"/)
  assert.match(panel, /consoleThemeObserver = new MutationObserver/, '切主题立刻重算调色板（上游 palette 是活的）')
})
