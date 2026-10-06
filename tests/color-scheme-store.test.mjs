// Color Scheme 的**存取通道**判据：localStorage 读写的容错（缺键补默认，不许按字段数判损坏）、
// 方案合并 → CSS 文本的形状（按基座主题限定 data-theme）、注入端的建/换/删三种路径。
// 依据坐标写在 src/colorSchemeStore.ts 文件头，这里钉行为。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BASE_COLOR_SCHEMES,
  COLOR_SCHEME_STORAGE_KEY,
  COLOR_SCHEME_STYLE_ELEMENT_ID,
  applyColorScheme,
  defaultColorSchemeState,
  loadColorSchemeState,
  saveColorSchemeState,
  schemeCssText,
} from '../src/colorSchemeStore.ts'

const storage = (initial = null) => {
  let value = initial
  return {
    read: () => value,
    write: v => { value = v },
    get: () => value,
  }
}

const copyScheme = (overrides, name = '_@user_TaoCode Light') => (
  { name, inheritFrom: 'TaoCode Light', theme: 'light', readOnly: false, overrides }
)

test('默认状态 = 两份只读基座、未选方案', () => {
  const state = defaultColorSchemeState()
  assert.equal(state.active, '')
  assert.deepEqual(state.schemes.map(s => s.name), BASE_COLOR_SCHEMES.map(s => s.name))
  assert.equal(state.schemes.every(s => s.readOnly), true)
})

test('无存档 / 坏 JSON / 顶层类型坏：全部回默认，不判损坏', () => {
  assert.deepEqual(loadColorSchemeState(() => null), defaultColorSchemeState())
  assert.deepEqual(loadColorSchemeState(() => '{ 半写入'), defaultColorSchemeState())
  assert.deepEqual(loadColorSchemeState(() => '[1,2]'), defaultColorSchemeState())
  assert.deepEqual(loadColorSchemeState(() => { throw new Error('storage off') }), defaultColorSchemeState())
})

test('旧存档缺键补默认：丢 active、丢基座、坏色值只丢键', () => {
  const half = JSON.stringify({
    active: '不存在的方案',
    schemes: [copyScheme({ DEFAULT_KEYWORD: '#FF8800', DEFAULT_STRING: 'not-a-color' })],
  })
  const state = loadColorSchemeState(() => half)
  assert.equal(state.active, '', 'active 指向不存在的方案要退回「跟随基座」')
  const names = state.schemes.map(s => s.name)
  assert.ok(names.includes('TaoCode Light') && names.includes('TaoCode Dark'), '基座缺键要补回')
  const editable = state.schemes.find(s => s.name === '_@user_TaoCode Light')
  assert.deepEqual(editable.overrides, { DEFAULT_KEYWORD: '#ff8800' }, '坏值丢键、好值小写化')
})

test('基座在存档里被伪造成可写也强制回只读', () => {
  const forged = JSON.stringify({
    active: 'TaoCode Light',
    schemes: [
      { name: 'TaoCode Light', inheritFrom: null, theme: 'light', readOnly: false, overrides: { DEFAULT_KEYWORD: '#111111' } },
      { name: 'TaoCode Dark', inheritFrom: null, theme: 'dark', readOnly: true, overrides: {} },
    ],
  })
  const state = loadColorSchemeState(() => forged)
  assert.equal(state.schemes.find(s => s.name === 'TaoCode Light').readOnly, true)
})

test('保存走注入的 write，键名钉住', () => {
  const box = storage()
  const state = { version: 1, active: '_@user_TaoCode Light', schemes: [...BASE_COLOR_SCHEMES, copyScheme({})] }
  saveColorSchemeState(state, box.write)
  assert.ok(JSON.parse(box.get()).active === '_@user_TaoCode Light')
  assert.equal(COLOR_SCHEME_STORAGE_KEY, 'taocode.editor.colorScheme')
})

test('读写一轮后信息不丢（active + 覆盖表原样回来）', () => {
  const box = storage()
  const state = { version: 1, active: '_@user_TaoCode Light', schemes: [...BASE_COLOR_SCHEMES, copyScheme({ DEFAULT_KEYWORD: '#112233' })] }
  saveColorSchemeState(state, box.write)
  const back = loadColorSchemeState(box.read)
  assert.equal(back.active, state.active)
  assert.deepEqual(back.schemes.find(s => s.name === state.active).overrides, { DEFAULT_KEYWORD: '#112233' })
})

test('CSS 文本：按基座主题限定 data-theme，变量按键序输出；未知键跳过', () => {
  const state = {
    version: 1,
    active: '_@user_TaoCode Light',
    schemes: [...BASE_COLOR_SCHEMES, copyScheme({ DEFAULT_STRING: '#222222', DEFAULT_KEYWORD: '#111111', NOT_A_KEY: '#333333' })],
  }
  const css = schemeCssText(state)
  assert.ok(css.startsWith(":root[data-theme='light'] {"), '浅色基座只染浅色面')
  assert.match(css, /--syntax-keyword: #111111;/)
  assert.ok(css.indexOf('--syntax-keyword') < css.indexOf('--syntax-string'), '按外部键排序输出')
  assert.ok(!css.includes('#333333'), '不认识的外部键不进 CSS')
})

test('CSS 文本：子方案赢过父方案；无选择/无覆盖 = 空串（注入端要删样式）', () => {
  const parent = copyScheme({ DEFAULT_KEYWORD: '#111111' })
  const child = { name: 'child', inheritFrom: parent.name, theme: 'light', readOnly: false, overrides: { DEFAULT_KEYWORD: '#999999' } }
  const state = { version: 1, active: 'child', schemes: [...BASE_COLOR_SCHEMES, parent, child] }
  assert.match(schemeCssText(state), /--syntax-keyword: #999999;/)
  assert.equal(schemeCssText({ ...state, active: '' }), '')
  assert.equal(schemeCssText(defaultColorSchemeState(), 'TaoCode Light'), '')
})

test('深色基座的方案不借光：CSS 选择器带 dark', () => {
  const darkCopy = { name: 'dc', inheritFrom: 'TaoCode Dark', theme: 'dark', readOnly: false, overrides: { DEFAULT_KEYWORD: '#abcdef' } }
  const state = { version: 1, active: 'dc', schemes: [...BASE_COLOR_SCHEMES, darkCopy] }
  assert.ok(schemeCssText(state).startsWith(":root[data-theme='dark'] {"))
})

// ── 注入端（假 document 三种路径）────────────────────────────────────────

const fakeDoc = () => {
  const appended = []
  return {
    elements: new Map(),
    appended,
    getElementById(id) { return this.elements.get(id) ?? null },
    createElement() { return { id: '', textContent: '' } },
    head: { appendChild: node => appended.push(node) },
  }
}

test('注入：没有样式元素就建一个并挂 head', () => {
  const doc = fakeDoc()
  const state = { version: 1, active: '_@user_TaoCode Light', schemes: [...BASE_COLOR_SCHEMES, copyScheme({ DEFAULT_KEYWORD: '#111111' })] }
  applyColorScheme(state, doc)
  assert.equal(doc.appended.length, 1)
  assert.equal(doc.appended[0].id, COLOR_SCHEME_STYLE_ELEMENT_ID)
  assert.match(doc.appended[0].textContent, /--syntax-keyword: #111111;/)
})

test('注入：已有样式元素只换文本，不叠加第二层', () => {
  const doc = fakeDoc()
  const existing = { textContent: 'old', remove: () => { doc.elements.delete(COLOR_SCHEME_STYLE_ELEMENT_ID) } }
  doc.elements.set(COLOR_SCHEME_STYLE_ELEMENT_ID, existing)
  const state = { version: 1, active: '_@user_TaoCode Light', schemes: [...BASE_COLOR_SCHEMES, copyScheme({ DEFAULT_STRING: '#222222' })] }
  applyColorScheme(state, doc)
  assert.equal(doc.appended.length, 0)
  assert.match(existing.textContent, /--syntax-string: #222222;/)
})

test('注入：切回基座（无覆盖）时清空并移除样式元素', () => {
  const doc = fakeDoc()
  let removed = false
  const existing = { textContent: ':root[data-theme=\'light\'] { --syntax-keyword: #111111;\n}', remove: () => { removed = true } }
  doc.elements.set(COLOR_SCHEME_STYLE_ELEMENT_ID, existing)
  applyColorScheme(defaultColorSchemeState(), doc)
  assert.equal(existing.textContent, '')
  assert.equal(removed, true)
})

test('注入：没有 DOM（node 测试环境）不炸', () => {
  const saved = globalThis.document
  globalThis.document = undefined
  try {
    applyColorScheme(defaultColorSchemeState())
  } finally {
    globalThis.document = saved
  }
})
