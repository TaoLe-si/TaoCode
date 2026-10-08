// exec/console 本轮的判据（一）：**控制台字体**。
//
// 上游：字号/行距住在配色方案的 Console Font 那一档
// （`EditorColorsScheme.java:121/125`、`AbstractColorsScheme.java:74/76/91`），控制台编辑器整片套用它
// （`ConsoleViewUtil.java:128-161`），设置页面是 `ConsoleFontOptions.java:27-124`，
// 界 4–40 与行距 .6–3 取 `EditorFontsConstants.java:11-22`。
// 本仓落点 `src/consoleFont.ts` + 消费点 `src/components/RunConsole.vue` 的 `.run-log`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  changeConsoleFontSize, changeConsoleLineSpacing, clampConsoleFontSize, clampConsoleLineSpacing, consoleFontCss, consoleFontLabel,
  consoleFontSizeForWheel, consoleFontSizeStep, consoleFontZoomApplies, CONSOLE_FONT_KEY,
  DEFAULT_CONSOLE_FONT, loadConsoleFontSettings, MAX_CONSOLE_FONT_SIZE, MAX_CONSOLE_LINE_SPACING,
  MIN_CONSOLE_FONT_SIZE, MIN_CONSOLE_LINE_SPACING, normalizeConsoleFontSettings, readConsoleFontSettings,
  resetConsoleFontSettings, saveConsoleFontSettings,
} from '../src/consoleFont.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/** 假存储（`consoleEncoding` 那一档同形）；`throwOn` 非空时对应方法抛错，用来核"存储不可用"不炸。 */
function memoryStore(seed) {
  const data = new Map(seed ? Object.entries(seed) : [])
  return {
    data,
    getItem(key) { return data.has(key) ? data.get(key) : null },
    setItem(key, value) { data.set(key, value) },
  }
}

test('缺省档 = 改造前 .run-log 的 12px/1.6，且默认档不写任何内联样式', () => {
  assert.deepEqual(DEFAULT_CONSOLE_FONT, { size: 12, lineSpacing: 1.6 })
  assert.deepEqual(consoleFontCss(DEFAULT_CONSOLE_FONT), {}, '默认档必须回空对象，否则会盖掉 .run-log 的 font 缩写')
  assert.deepEqual(consoleFontCss(resetConsoleFontSettings()), {})
  const vue = read('src/components/RunConsole.vue')
  assert.match(vue, /\.run-log \{[^}]*font: 12px\/1\.6 var\(--font-mono\)/, '.run-log 的默认字体缩写必须还在（默认档靠它生效）')
  assert.match(vue, /DEFAULT_CONSOLE_FONT|resetConsoleFontSettings/, '组件必须走 src/consoleFont.ts 的缺省档，不许自己抄一份')
})

test('界：字号夹到 4–40（EditorFontsConstants:11-17），行距夹到 .6–3（:18-22），坏值回缺省', () => {
  assert.equal(MIN_CONSOLE_FONT_SIZE, 4)
  assert.equal(MAX_CONSOLE_FONT_SIZE, 40)
  assert.equal(MIN_CONSOLE_LINE_SPACING, 0.6)
  assert.equal(MAX_CONSOLE_LINE_SPACING, 3)
  assert.equal(clampConsoleFontSize(3), 4)
  assert.equal(clampConsoleFontSize(99), 40)
  assert.equal(clampConsoleFontSize('nonsense'), 12)
  assert.equal(clampConsoleFontSize(undefined), 12)
  assert.equal(clampConsoleLineSpacing(0.1), 0.6)
  assert.equal(clampConsoleLineSpacing(9), 3)
  assert.equal(clampConsoleLineSpacing('x'), 1.6)
})

test('读档：坏 JSON 回默认；缺键各回各的默认；越界值在读取时就夹好', () => {
  assert.deepEqual(loadConsoleFontSettings(null), { size: 12, lineSpacing: 1.6 })
  assert.deepEqual(loadConsoleFontSettings('{oops'), { size: 12, lineSpacing: 1.6 })
  assert.deepEqual(loadConsoleFontSettings('{"size":18}'), { size: 18, lineSpacing: 1.6 }, '只写了字号 ⇒ 行距回默认')
  assert.deepEqual(loadConsoleFontSettings('{"lineSpacing":2.2}'), { size: 12, lineSpacing: 2.2 })
  assert.deepEqual(loadConsoleFontSettings('{"size":999,"lineSpacing":-1}'), { size: 40, lineSpacing: 0.6 })
  assert.deepEqual(normalizeConsoleFontSettings([1, 2]), { size: 12, lineSpacing: 1.6 }, '不是对象就整份回默认')
})

test('读写往返走 CONSOLE_FONT_KEY 那一格；存储不可用/坏值时不炸也不写坏值', () => {
  assert.equal(CONSOLE_FONT_KEY, 'taocode.consoleFont')
  const store = memoryStore()
  saveConsoleFontSettings(store, { size: 16, lineSpacing: 2 })
  assert.equal(store.data.get(CONSOLE_FONT_KEY), '{"size":16,"lineSpacing":2}')
  assert.deepEqual(readConsoleFontSettings(store), { size: 16, lineSpacing: 2 })
  saveConsoleFontSettings(store, { size: 900, lineSpacing: 0 })
  assert.deepEqual(readConsoleFontSettings(store), { size: 40, lineSpacing: 0.6 }, '写盘前也要夹取')
  const hostile = {
    getItem() { throw new Error('no storage') },
    setItem() { throw new Error('no storage') },
  }
  assert.deepEqual(readConsoleFontSettings(hostile), { size: 12, lineSpacing: 1.6 })
  saveConsoleFontSettings(hostile, { size: 20, lineSpacing: 1.5 })
  assert.deepEqual(readConsoleFontSettings(memoryStore({ [CONSOLE_FONT_KEY]: '{"size":20,"lineSpacing":1.5}' })),
    { size: 20, lineSpacing: 1.5 })
})

test('字号步进：一次 ±1，到界**保持原值**（不是夹到界上）；两枚按钮的启用判定同源', () => {
  assert.equal(changeConsoleFontSize(12, 1), 13)
  assert.equal(changeConsoleFontSize(12, -1), 11)
  assert.equal(changeConsoleFontSize(MAX_CONSOLE_FONT_SIZE, 1), MAX_CONSOLE_FONT_SIZE, '到界再加仍是 40（保持原值）')
  assert.equal(changeConsoleFontSize(MIN_CONSOLE_FONT_SIZE, -1), MIN_CONSOLE_FONT_SIZE)
  assert.deepEqual(consoleFontSizeStep(MIN_CONSOLE_FONT_SIZE), { canIncrease: true, canDecrease: false })
  assert.deepEqual(consoleFontSizeStep(MAX_CONSOLE_FONT_SIZE), { canIncrease: false, canDecrease: true })
  assert.deepEqual(consoleFontSizeStep(20), { canIncrease: true, canDecrease: true })
})

test('Ctrl+滚轮：门 = 「Ctrl+滚轮改字号」设置 且 Ctrl 按下；往上滚变大、往下滚变小、到界不动', () => {
  assert.equal(consoleFontZoomApplies({ ctrlKey: true }, true), true)
  assert.equal(consoleFontZoomApplies({ metaKey: true }, true), true)
  assert.equal(consoleFontZoomApplies({}, true), false, '没按 Ctrl 不许改字号（照常滚缓冲区）')
  assert.equal(consoleFontZoomApplies({ ctrlKey: true }, false), false, '总闸没开不许改字号（上游缺省 false）')
  assert.equal(consoleFontSizeForWheel(12, -100), 13)
  assert.equal(consoleFontSizeForWheel(12, 100), 11)
  assert.equal(consoleFontSizeForWheel(MAX_CONSOLE_FONT_SIZE, -100), MAX_CONSOLE_FONT_SIZE)
  assert.equal(consoleFontSizeForWheel(12, 0), 12, 'deltaY 为 0 时不动')
})

test('提示文案：带上下限，默认档额外标出「默认」', () => {
  const label = consoleFontLabel(DEFAULT_CONSOLE_FONT)
  assert.match(label, /12px/)
  assert.match(label, /1\.6/)
  assert.match(label, new RegExp(`${MIN_CONSOLE_FONT_SIZE}–${MAX_CONSOLE_FONT_SIZE}px`))
  assert.match(label, /默认/)
  assert.doesNotMatch(consoleFontLabel({ size: 20, lineSpacing: 2 }), /默认/)
})

test('行距：改的是设置里的那一格，界内任意小数照收，空/坏输入保持原值', () => {
  const base = { size: 12, lineSpacing: 1.6 }
  assert.deepEqual(changeConsoleLineSpacing(base, '2.2'), { size: 12, lineSpacing: 2.2 })
  assert.deepEqual(changeConsoleLineSpacing(base, '9'), { size: 12, lineSpacing: 3 }, '越界夹回 3')
  assert.deepEqual(changeConsoleLineSpacing(base, '0.1'), { size: 12, lineSpacing: 0.6 })
  assert.deepEqual(changeConsoleLineSpacing(base, ''), base, '清空输入框不该把行距弹回默认')
  assert.deepEqual(changeConsoleLineSpacing(base, 'abc'), base)
  assert.deepEqual(changeConsoleLineSpacing(base, undefined), base)
  assert.deepEqual(consoleFontCss({ size: 12, lineSpacing: 2 }), { lineHeight: '2' }, '行距改了才写那一格')
  assert.deepEqual(consoleFontCss({ size: 20, lineSpacing: 1.6 }), { fontSize: '20px' }, '只写变了的那一格')
  assert.deepEqual(consoleFontCss({ size: 20, lineSpacing: 2 }), { fontSize: '20px', lineHeight: '2' })
})

test('接线：RunConsole 的 .run-log 用 consoleFontCss、滚轮走这一层、工具条三枚按钮都在', () => {
  const vue = read('src/components/RunConsole.vue')
  assert.match(vue, /import\s*\{[^}]*consoleFontCss[^}]*\}\s*from '\.\.\/consoleFont\.ts'/, '必须从 consoleFont.ts 取样式投影')
  assert.match(vue, /<div class="run-log"[^>]*:style="consoleFontStyle"[^>]*@wheel="onLogWheel"/,
    '.run-log 上要同时挂样式与滚轮')
  assert.match(vue, /consoleFontCss\(consoleFontEffective\.value\)/, '样式来自 consoleFontCss，不许自己拼 font 串')
  assert.match(vue, /stepConsoleFont\(CONSOLE_FONT_SIZE_STEP_DOWN\)/)
  assert.match(vue, /stepConsoleFont\(CONSOLE_FONT_SIZE_STEP_UP\)/)
  assert.match(vue, /@click="resetConsoleFont"/)
  assert.match(vue, /@change="onFontSpacingChange"/, '行距那一格要有入口（不然持久化里的行距是死代码）')
  assert.match(vue, /changeConsoleLineSpacing\(consoleFontSettings\.value, value\)/, '行距的夹取走模块里的那一条')
  assert.match(vue, /readConsoleFontSettings\(/, '进入面板要读回已存的设置')
  assert.match(vue, /saveConsoleFontSettings\(/, '改设置要写回')
  assert.match(vue, /consoleFontZoomApplies\(event, props\.wheelFontChangeEnabled \?\? false\)/,
    '滚轮的门缺省必须 false（上游 IS_WHEEL_FONTCHANGE_ENABLED 默认 false），不许假装门是开的')
})

test('上游坐标可核：模块注释点出 EditorColorsScheme/ConsoleViewUtil/ConsoleFontOptions/EditorFontsConstants 的文件与行号', () => {
  const module = read('src/consoleFont.ts')
  for (const coordinate of [
    'EditorColorsScheme.java:121', 'ConsoleViewUtil.java:128-161', 'ConsoleFontOptions.java:27-124',
    'EditorFontsConstants.java:11-17', 'AbstractColorsScheme.java:76',
  ]) {
    assert.ok(module.includes(coordinate), `模块注释缺上游坐标 ${coordinate}`)
  }
})
