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
  const css = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8')
  for (const section of css.split(":root[data-theme='dark']")) {
    const palette = Object.fromEntries([...section.matchAll(/--([a-z-]+):\s*(#[\da-f]{6});/gi)].map(match => [match[1], match[2]]))
    for (const text of ['text', 'secondary', 'muted']) for (const surface of ['editor', 'panel', 'rail', 'elevated']) {
      const ratio = contrast(palette[text], palette[surface])
      assert.ok(ratio >= 4.5, `${text} on ${surface}: ${ratio.toFixed(2)}`)
    }
    assert.ok(contrast(palette['on-accent'], palette.accent) >= 4.5, 'primary button text')
    for (const [name, color] of Object.entries(palette).filter(([name]) => name.startsWith('syntax-'))) {
      assert.ok(contrast(color, palette.editor) >= 4.5, `${name} on editor`)
    }
    assert.notEqual(palette.selection, palette['selection-inactive'], 'focused and unfocused selection are distinct')
  }
})

test('line and occurrence backgrounds cannot hide the selection layer beneath them', () => {
  const css = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8')
  const alpha = color => color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1
  assert.equal(alpha('#f4f6fa'), 1, 'the old opaque active-line color would cover a drawn selection')
  for (const name of ['active-line', 'symbol-highlight', 'debug-line']) {
    const values = [...css.matchAll(new RegExp(`--${name}:\\s*(#[\\da-f]+);`, 'gi'))]
    assert.equal(values.length, 2, `${name} needs both themes`)
    for (const match of values) assert.ok(alpha(match[1]) < 0.2, `${name} must let the selection show through`)
  }
})

test('splitter sizes stay bounded even when the available width is too small', () => {
  assert.equal(clampPanelSize(360, 180, 520), 360)
  assert.equal(clampPanelSize(-100, 180, 520), 180)
  assert.equal(clampPanelSize(900, 180, 520), 520)
  assert.equal(clampPanelSize(240, 180, 100), 180)
  assert.equal(clampPanelSize(240.7, 180, 520), 241)
})
