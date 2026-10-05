// 装配根搬出来的四条小规则：语言显示名 / 重命名校验 / 状态栏工具窗口分组 / Smart Mode 文案。
// 2026-10-06 从 src/App.vue 逐字搬进 src/appLanguageLabels.ts、src/appRenameRules.ts、
// src/appToolWindowGroups.ts、src/appSmartMode.ts。
//
// 用例钉的是**搬动前那段 if 链的输出**：文案一字不差、判定顺序不变、分支不增不减。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { editorLanguageLabel, languageLabels } from '../src/appLanguageLabels.ts'
import { JAVA_KEYWORDS, renameNameProblem } from '../src/appRenameRules.ts'
import { groupToolWindowsByAnchor } from '../src/appToolWindowGroups.ts'
import { smartModeLabelOf } from '../src/appSmartMode.ts'
import { toolWindowOrder } from '../src/toolWindowMeta.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('关联表就是那四档显示名，键与 EDITOR_LANGUAGES 对齐', () => {
  assert.deepEqual(languageLabels, { java: 'Java', cpp: 'C++', typescript: 'TypeScript', other: '纯文本' })
})

test('项目关联覆盖优先：命中用表里的名字，表里没有的原样显示', () => {
  assert.equal(editorLanguageLabel('src/Main.java', 'java'), 'Java')
  assert.equal(editorLanguageLabel('src/Main.java', 'other'), '纯文本')
  assert.equal(editorLanguageLabel('src/Main.java', 'kotlin'), 'kotlin', '关联到表外的语言时按关联值显示')
  assert.equal(editorLanguageLabel('README.md'), '纯文本', '没有关联就落到扩展名兜底')
})

test('没关联时按扩展名兜底，顺序与判定和搬走之前一致', () => {
  const cases = [
    ['src/a/B.java', 'Java'], ['main.c', 'C++'], ['x.cpp', 'C++'], ['y.hpp', 'C++'], ['z.cc', 'C++'], ['w.cxx', 'C++'],
    ['src/App.vue', 'Vue'], ['src/main.ts', 'TypeScript'], ['src/i18n.tsx', 'TypeScript'],
    ['web/app.js', 'JavaScript'], ['web/a.cjs', 'JavaScript'], ['web/b.mjs', 'JavaScript'],
    ['package.json', 'JSON'], ['native/CMakeLists.txt', 'CMake'], ['build/cmakelists.txt', 'CMake'],
    ['notes.txt', '纯文本'], ['README', '纯文本'], ['', '纯文本'],
  ]
  for (const [path, label] of cases)
    assert.equal(editorLanguageLabel(path), label, `${path} 的显示名不对`)
})

test('重命名校验：空输入与「没有当前名」都不提示（名字由装配根先 trim 过）', () => {
  assert.equal(renameNameProblem('', 'foo', true), '')
  assert.equal(renameNameProblem('foo', null, true), '', '没有打开重命名框时不该报任何话')
})

test('重命名校验：与当前名相同 / 不是标识符 / Java 关键字，三档文案一字不差', () => {
  assert.equal(renameNameProblem('foo', 'foo', false), '新名称与当前名称相同。')
  assert.equal(renameNameProblem('2fast', 'foo', false),
    '“2fast”不是有效的标识符：只能包含字母、数字、下划线和 $，且不能以数字开头。')
  assert.equal(renameNameProblem('a-b', 'foo', false),
    '“a-b”不是有效的标识符：只能包含字母、数字、下划线和 $，且不能以数字开头。')
  assert.equal(renameNameProblem('class', 'foo', true), '“class”是 Java 关键字，不能作为标识符。')
})

test('重命名校验：$ 与下划线开头合法，关键字只在 .java 里拦', () => {
  assert.equal(renameNameProblem('_local', 'foo', true), '')
  assert.equal(renameNameProblem('$ref', 'foo', true), '')
  assert.equal(renameNameProblem('record', 'foo', false), '', '非 Java 文件不套 Java 关键字')
  assert.equal(renameNameProblem('var', 'foo', true), '“var”是 Java 关键字，不能作为标识符。')
  assert.ok(JAVA_KEYWORDS.has('strictfp') && JAVA_KEYWORDS.has('assert'), '关键字表少了受限/旧关键字')
})

test('工具窗口弹窗按停靠边分组：左 → 底 → 右，空组整组不出现', () => {
  const [first, second, third] = toolWindowOrder
  const groups = groupToolWindowsByAnchor({
    order: [first, second, third],
    anchorOf: id => (id === first ? 'left' : id === second ? 'bottom' : 'right'),
    titleOf: id => (id === first ? '项目' : id === second ? '输出' : '结构'),
    isDisabled: () => false,
  })
  assert.deepEqual(groups.map(group => group.anchor), ['left', 'bottom', 'right'], '分组顺序不对')
  assert.deepEqual(groups.map(group => group.label), ['左侧', '底部', '右侧'])
  assert.deepEqual(groups.map(group => group.ids), [[first], [second], [third]])
})

test('工具窗口分组：没有锚点记录的按左侧算（原 computed 里的 ?? 兜底），空组不出现', () => {
  const [first, second] = toolWindowOrder
  const groups = groupToolWindowsByAnchor({
    order: [second, first], anchorOf: () => undefined,
    titleOf: id => (id === first ? 'b' : 'a'), isDisabled: () => false,
  })
  assert.deepEqual(groups.map(group => group.anchor), ['left'], '只有 left 一组，其余空组要被丢掉')
  assert.deepEqual(groups[0].ids, [second, first], '组内按标题排序')
})

test('工具窗口分组：禁用项不入组，桶内按条纹标题的自然序排', () => {
  const [a, b, c] = toolWindowOrder
  const groups = groupToolWindowsByAnchor({
    order: [c, b, a],
    anchorOf: () => 'left',
    titleOf: id => (id === a ? '面板 10' : id === b ? '面板 2' : '禁用的'),
    isDisabled: id => id === c,
  })
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].ids, [b, a], '数字段要按数值比（naturalCompare），且禁用项不入组')
})

test('Smart Mode 文案：判定顺序与五档兜底和搬走之前的 if 链一致', () => {
  const base = { hasActive: true, loadingSettings: false, lspRunning: false, isDesktop: true, lspConfigured: true }
  assert.equal(smartModeLabelOf({ ...base, hasActive: false }), '')
  assert.equal(smartModeLabelOf({ ...base, loadingSettings: true }), '正在载入设置')
  assert.equal(smartModeLabelOf({ ...base, lspRunning: true }), '')
  assert.equal(smartModeLabelOf({ ...base, isDesktop: false }), '')
  assert.equal(smartModeLabelOf({ ...base, lspConfigured: false }), '', '没配服务是本 IDE 的正常状态，不报「未就绪」')
  assert.equal(smartModeLabelOf(base), '语言服务未就绪')
  // 「正在载入设置」排在「服务已跑起来」之前：设置没读出来时不能显示空指示器。
  assert.equal(smartModeLabelOf({ ...base, loadingSettings: true, lspRunning: true }), '正在载入设置')
})

test('装配根把四条规则接回原来的通道', () => {
  const app = read('src/App.vue')
  assert.match(app, /import \{ languageLabels, editorLanguageLabel \} from '\.\/appLanguageLabels\.ts'/)
  assert.match(app, /return editorLanguageLabel\(path, associationOf\(path\)\)/, '状态栏语言名不再走搬走的规则')
  assert.match(app, /const language = computed\(\(\) => languageOf\(active\.value\?\.path \?\? ''\)\)/)
  assert.match(app, /import \{ renameNameProblem \} from '\.\/appRenameRules\.ts'/)
  assert.match(app, /renameValue\.value\.trim\(\), renamePrompt\.value \? renamePrompt\.value\.current : null, \/\\.java\$\/\.test\(active\.value\?\.\s*path \?\? ''\)\)/,
    '重命名框的校验没有把三个输入喂进去')
  assert.match(app, /import \{ groupToolWindowsByAnchor \} from '\.\/appToolWindowGroups\.ts'/)
  assert.match(app, /const groupedAvailableToolWindows = computed\(\(\) => groupToolWindowsByAnchor\(\{/, '弹窗不再按分组规则出组')
  assert.match(app, /import \{ smartModeLabelOf \} from '\.\/appSmartMode\.ts'/)
  assert.match(app, /const smartModeLabel = computed\(\(\) => smartModeLabelOf\(\{/, '状态栏指示器不再用搬走的规则')
  // 搬走的代码不许在装配根留第二份。
  assert.ok(!/const languageLabels: Record<string, string> =/.test(app), 'App.vue 里还留着语言显示名表')
  assert.ok(!/const javaKeywords = new Set/.test(app), 'App.vue 里还留着 Java 关键字表')
})
