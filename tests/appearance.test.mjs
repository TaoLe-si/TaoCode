import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveTheme, clampPanelSize, initialTheme, themeStorageKey } from '../src/appearance.ts'

test('explicit light and dark choices override the system preference', () => {
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('dark', false), 'dark')
  assert.equal(resolveTheme(null, true), 'dark')
  assert.equal(resolveTheme('invalid', false), 'light')
  assert.equal(resolveTheme({}, true), 'dark')
})

test('startup restores the stored theme and tolerates blocked storage', () => {
  globalThis.window = { matchMedia: () => ({ matches: true }) }
  globalThis.localStorage = { getItem: key => { assert.equal(key, themeStorageKey); return 'light' } }
  assert.equal(initialTheme(), 'light')
  globalThis.localStorage = { getItem: () => { throw new Error('blocked') } }
  assert.equal(initialTheme(), 'dark')
  delete globalThis.window
  delete globalThis.localStorage
})

/**
 * 按 CSS 的层叠方式把令牌解析成**实际色值**。
 * tokens.css 现在是三层：月相原色（`--m-*`，每档一套）→ 语义别名（只声明一次，`var(--m-*)`）。
 * 所以判对比度必须顺着 `var()` 解析到底，不能只看语义名后面写没写十六进制 ——
 * 那样只会因为"改成引用"而误报，也会漏掉"引用了一个没在暗面重声明的原色"。
 */
function paletteOf(theme) {
  const css = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8')
  const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf("[data-theme='light']"))
  const darkBlock = css.slice(css.indexOf(":root[data-theme='dark']"))
  const decls = new Map()
  const collect = block => {
    for (const match of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gi)) decls.set(match[1].toLowerCase(), match[2].trim())
  }
  // 亮面基底 = `:root`（语义别名 + 亮面月相）；暗面在它之上**只覆盖自己重声明的那些**
  // （深色块只写月相原色，语义名靠继承 —— 这正是三层结构想要的效果）。
  collect(rootBlock)
  if (theme === 'dark') collect(darkBlock)
  const resolve = (name, depth = 0) => {
    if (depth > 12) return undefined
    const value = decls.get(name.toLowerCase())
    if (!value) return undefined
    const ref = /^var\(--([a-z0-9-]+)(?:,[^)]*)?\)$/i.exec(value)
    return ref ? resolve(ref[1], depth + 1) : value
  }
  return { get: name => resolve(name), names: [...decls.keys()] }
}

test('both palettes keep small UI text at WCAG AA contrast', () => {
  const luminance = hex => {
    const rgb = hex.match(/[\da-f]{2}/gi).map(part => parseInt(part, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  }
  const contrast = (a, b) => {
    const x = luminance(a), y = luminance(b)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }
  assert.equal(contrast('#ffffff', '#000000'), 21)
  assert.ok(contrast('#bbbbbb', '#ffffff') < 4.5, 'low contrast must fail the same threshold')
  for (const theme of ['light', 'dark']) {
    const palette = paletteOf(theme)
    const color = name => {
      const value = palette.get(name)
      assert.ok(typeof value === 'string' && /^#[\da-f]{6}$/i.test(value),
        `${theme}: --${name} 解析出来不是六位色（拿到 ${value}）—— 月相层大概漏了这个名字`)
      return value
    }
    for (const text of ['text', 'secondary', 'muted']) for (const surface of ['editor', 'panel', 'rail', 'elevated']) {
      const ratio = contrast(color(text), color(surface))
      assert.ok(ratio >= 4.5, `${theme} ${text} on ${surface}: ${ratio.toFixed(2)}`)
    }
    assert.ok(contrast(color('on-accent'), color('accent')) >= 4.5, `${theme} primary button text`)
    for (const name of palette.names.filter(name => name.startsWith('syntax-'))) {
      const ratio = contrast(color(name), color('editor'))
      assert.ok(ratio >= 4.5, `${theme} ${name} on editor: ${ratio.toFixed(2)}`)
    }
    assert.notEqual(color('selection'), color('selection-inactive'), 'focused and unfocused selection are distinct')
  }
})

test('line and occurrence backgrounds cannot hide the selection layer beneath them', () => {
  const alpha = color => color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1
  assert.equal(alpha('#f4f6fa'), 1, 'the old opaque active-line color would cover a drawn selection')
  for (const theme of ['light', 'dark']) {
    const palette = paletteOf(theme)
    for (const name of ['active-line', 'symbol-highlight', 'debug-line']) {
      const value = palette.get(name)
      assert.ok(typeof value === 'string' && /^#[\da-f]{6}[\da-f]{2}$/i.test(value),
        `${theme}: --${name} 必须是带 alpha 的色值（拿到 ${value}）`)
      assert.ok(alpha(value) < 0.2, `${theme}: ${name} 要让选区透出来（alpha=${alpha(value).toFixed(2)}）`)
    }
  }
})

test('splitter sizes stay bounded even when the available width is too small', () => {
  assert.equal(clampPanelSize(360, 180, 520), 360)
  assert.equal(clampPanelSize(-100, 180, 520), 180)
  assert.equal(clampPanelSize(900, 180, 520), 520)
  assert.equal(clampPanelSize(240, 180, 100), 180)
  assert.equal(clampPanelSize(240.7, 180, 520), 241)
})
