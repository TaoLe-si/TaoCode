// 文件颜色（IDEA `com.intellij.ui.tabs` 的 File Colors 一族）的判定逻辑。
//
// 依据全在 src/fileColors.ts 文件头：七色取自 `FileColorManagerImpl.ourDefaultColors`、
// 「首个命中」取自 `FileColorsModel.findConfigurationWithScopeFilter:247-260`、
// 两层开关取自 `isEnabled()` / `isEnabledForTabs()`。这里只钉行为，不复述实现。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FILE_COLOR_HEX,
  FILE_COLOR_NAMES,
  isFileColorName,
  normalizeFileColor,
  normalizeFileColors,
  resolveFileColor,
  tabFileColorEnabled,
} from '../src/fileColors.ts'

// 作用域表达式用的是 IDEA 的 scope 语言（要带类型前缀 `file:` / `projectPath:` / `ext:` / `$name`），
// 与 src/scopes.test.mjs 里的写法一致。
const scopes = [
  { name: '生成物', pattern: 'projectPath:build//**', shared: false },
  // 故意与「生成物」重叠，用来验证优先级只看顺序。
  { name: '构建产物', pattern: 'projectPath:build//*', shared: false },
  { name: '文档', pattern: 'projectPath:docs//**', shared: false },
  { name: '源码', pattern: 'projectPath:src//**', shared: true },
]

const hit = (path, fileColors) => resolveFileColor({ path, scopes, fileColors, context: { moduleName: 'demo' } })

test('七个具名色与明暗两套值都来自 ourDefaultColors', () => {
  assert.deepEqual([...FILE_COLOR_NAMES], ['Blue', 'Green', 'Orange', 'Rose', 'Violet', 'Yellow', 'Gray'])
  assert.equal(FILE_COLOR_HEX.Blue.light, '#eaf6ff')
  assert.equal(FILE_COLOR_HEX.Blue.dark, '#4f556b')
  assert.equal(FILE_COLOR_HEX.Gray.light, '#f5f5f5')
  assert.equal(FILE_COLOR_HEX.Yellow.dark, '#4f4b41')
})

test('落在作用域里的文件才拿到颜色，且给出命中的作用域名', () => {
  assert.deepEqual(hit('build/out.js', [{ scope: '生成物', color: 'Gray' }]), { color: 'Gray', scope: '生成物' })
  assert.deepEqual(hit('src/main.cpp', [{ scope: '源码', color: 'Blue' }]), { color: 'Blue', scope: '源码' })
})

test('不落在任何作用域里就没有颜色（标签页不画色块）', () => {
  assert.equal(hit('README.md', [{ scope: '生成物', color: 'Gray' }]), null)
  assert.equal(hit('build/out.js', []), null, '没有配置就没有颜色')
})

test('首个命中就赢 —— 顺序即优先级，不比谁更具体', () => {
  // 「生成物」(build//**) 与「构建产物」(build//*) 都含 build/out.js：
  // 源码里 `findConfigurationWithScopeFilter` 顺着迭代器第一个就 return。
  const both = [{ scope: '生成物', color: 'Gray' }, { scope: '构建产物', color: 'Blue' }]
  assert.deepEqual(hit('build/out.js', both), { color: 'Gray', scope: '生成物' })
  assert.deepEqual(hit('build/out.js', [...both].reverse()), { color: 'Blue', scope: '构建产物' },
    '把顺序反过来，赢的就是另一条 —— 证明不是按具体程度挑的')
})

test('作用域没定义 / 表达式非法都算这一条不匹配', () => {
  assert.equal(hit('src/main.cpp', [{ scope: '不存在', color: 'Blue' }]), null, '查不到作用域定义就跳过')
  assert.equal(hit('src/main.cpp', [{ scope: '文档', color: 'Blue' }]), null, '不匹配就跳过')
})

test('存的是颜色名：认不出的值按 Gray 兜底（与 getColor 的 Map 语义一致）', () => {
  assert.equal(isFileColorName('Blue'), true)
  assert.equal(isFileColorName('#ff0000'), false)
  assert.equal(normalizeFileColor('Violet'), 'Violet')
  assert.equal(normalizeFileColor('#ff0000'), 'Gray')
  assert.equal(normalizeFileColor(undefined), 'Gray')
})

test('总开关与标签页开关是两层，默认都开', () => {
  assert.equal(tabFileColorEnabled({}), true, 'FileColorsEnabled 默认 true')
  assert.equal(tabFileColorEnabled({ fileColorsEnabled: false }), false)
  assert.equal(tabFileColorEnabled({ fileColorsForTabs: false }), false)
  assert.equal(tabFileColorEnabled({ fileColorsEnabled: true, fileColorsForTabs: false }), false, '标签页开关单独也能关')
})

test('归一化：丢掉作用域不存在的、同名的只留第一条（与「首个命中」一致）', () => {
  const normalized = normalizeFileColors([
    { scope: '源码', color: 'Blue' },
    { scope: '源码', color: 'Rose' },
    { scope: '没了', color: 'Blue' },
    { scope: '文档', color: 'nonsense' },
    null,
  ], scopes)
  assert.deepEqual(normalized, [{ scope: '源码', color: 'Blue' }, { scope: '文档', color: 'Gray' }])
  assert.deepEqual(normalizeFileColors('不是数组', scopes), [])
})
