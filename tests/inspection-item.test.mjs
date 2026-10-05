// 检查项粒度的 profile 门控 —— `src/inspectionProfile.ts` 的 `applyInspectionProfile` / `inspectionItems`。
//
// 上游依据：
//   · 启停与级别的粒度是**单个检查项 key**：
//     `platform/analysis-impl/src/com/intellij/codeInspection/ex/InspectionProfileImpl.java:804`
//     （`isToolEnabled(HighlightDisplayKey key, PsiElement)`）与 `:546`（`getToolDefaultState(toolShortName, project)`）；
//   · 检查项 key 的身份来源与显示名解析：
//     `platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/HighlightingProblem.kt:85-89`
//     （`problemGroup.problemName ?: inspectionToolId`）；
//     `platform/analysis-impl/src/com/intellij/codeInsight/daemon/impl/HighlightInfo.java:473-481`
//     （`getInspectionToolId()` / `getExternalSourceId()`）；
//   · XML 的逐工具形状（`class` / `enabled` / `level`）：
//     `platform/analysis-impl/src/com/intellij/codeInspection/ex/ToolsImpl.java:40-42`。
// 本仓的键 = `src/inspectionIdentity.ts` 折出来的候选键链，门控按「具体 → 宽泛」取第一个有登记的。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const {
  applyInspectionProfile, DEFAULT_PROFILE_NAME, exportProfileXml, inspectionItems,
  importProfileXml, parseProfileXml, resetInspectionProfile, resetInspectionTool,
  setInspectionToolEnabled, setInspectionToolSeverity, toolSettingFor,
} = await import('../src/inspectionProfile.ts')

const read = path => readFileSync(path, 'utf8')
const row = (over = {}) => ({
  path: 'src/a/One.ts', line: 0, character: 0, severity: 2, message: 'm', source: '', ...over,
})

test('停用/级别的查找按身份键逐级走：窄档赢宽档，上级停用牵连下级', () => {
  resetInspectionProfile()
  // 只登记「检查器::码」：同检查器的其它码不受影响（上游的粒度就是一个检查项一个 key）。
  setInspectionToolEnabled('eslint::quotes', false)
  assert.equal(applyInspectionProfile('eslint', 2, 'quotes'), null)
  assert.equal(applyInspectionProfile('eslint', 2, 'semi'), 2, '没登记的码按服务端原值')
  // 再把整个 eslint 停掉：两条都不落表；恢复窄档也不覆盖宽档的停用（第一个命中的键赢）。
  setInspectionToolEnabled('eslint', false)
  assert.equal(applyInspectionProfile('eslint', 2, 'semi'), null)
  assert.equal(applyInspectionProfile('jdt', 1, 'unused'), 1, '别的检查器不受牵连')
  resetInspectionProfile()
})

test('tags 折出来的伪检查项（unused / Deprecation）单独一把键', () => {
  resetInspectionProfile()
  setInspectionToolEnabled('#unused', false)
  assert.equal(applyInspectionProfile('eslint', 2, 'no-unused-vars', [1]), null,
    '未使用符号整档停用（上游这两档本身就是注册出来的 HighlightDisplayKey）')
  assert.equal(applyInspectionProfile('eslint', 2, 'no-unused-vars'), 2, '同样的码没有 tags 时不算未使用')
  assert.equal(applyInspectionProfile('eslint', 2, 'deprecation-x', [2]), 2, '已废弃那档不受影响')
  setInspectionToolSeverity('#Deprecation', 1)
  assert.equal(applyInspectionProfile('eslint', 2, 'x', [2]), 1, '级别覆盖同样按伪检查项走')
  resetInspectionProfile()
})

test('旧存档的两种键形状继续生效（裸 source 与空键）', () => {
  resetInspectionProfile()
  setInspectionToolSeverity('tsserver', 1)
  assert.equal(applyInspectionProfile('tsserver', 2, '2304'), 1, '只有检查器级登记时，带码的诊断仍走它')
  setInspectionToolEnabled('', false)
  assert.equal(applyInspectionProfile('', 2), null, '「无来源」那一条登记在空键上，不能失效')
  assert.deepEqual(toolSettingFor(''), { enabled: false, severity: null })
  resetInspectionProfile()
  assert.equal(applyInspectionProfile('', 2), 2)
})

test('inspectionItems 按检查项列清单：计数、显示名、上级牵连都带上', () => {
  resetInspectionProfile()
  const rows = [
    row({ source: 'eslint', code: 'quotes' }),
    row({ source: 'eslint', code: 'quotes', path: 'src/b/Two.ts' }),
    row({ source: 'eslint', code: 'semi' }),
    row({ source: 'eslint', code: 'no-unused', tags: [1] }),
    row({}),
  ]
  const items = inspectionItems(rows)
  const byKey = new Map(items.map(item => [item.key, item]))
  assert.deepEqual([...byKey.keys()].sort(), ['', '#unused', 'eslint::quotes', 'eslint::semi'],
    'tags 那档从同码同检查器里分出去（显示名就是上游注册出来的那个）')
  assert.equal(byKey.get('eslint::quotes').count, 2)
  assert.equal(byKey.get('eslint::quotes').label, 'eslint (quotes)')
  assert.equal(byKey.get('#unused').label, 'Unused declaration')
  assert.equal(byKey.get('#unused').kind, 'unusedSymbol')
  assert.equal(byKey.get('').label, '（无来源）', '没有身份的行也要出现在清单里，否则停不掉')
  assert.deepEqual(byKey.get('eslint::quotes').setting, { enabled: true, severity: null })
  // 上级停用时给出「随谁停用」，面板据此标注，不把「本项启用」误读成「它在跑」。
  setInspectionToolEnabled('eslint', false)
  const after = new Map(inspectionItems(rows).map(item => [item.key, item]))
  assert.equal(after.get('eslint::quotes').disabledBy, 'eslint')
  assert.equal(after.get('#unused').disabledBy, 'eslint', '伪检查项那档的下一级仍是检查器')
  assert.equal(after.get('').disabledBy, null)
  resetInspectionProfile()
})

test('检查项键能过 XML 往返（class 属性对本仓是 opaque 身份串）', () => {
  resetInspectionProfile()
  setInspectionToolEnabled('eslint::quotes', false)
  setInspectionToolSeverity('tsserver::6133', 4)
  const xml = exportProfileXml(DEFAULT_PROFILE_NAME)
  assert.match(xml, /class="eslint::quotes"/, '停用条目按身份键写 class')
  assert.match(xml, /level="INFO"/, '级别覆盖写上游那一套级别名')
  const parsed = parseProfileXml(xml)
  assert.equal(parsed.profile.tools['eslint::quotes'].enabled, false)
  assert.equal(parsed.profile.tools['tsserver::6133'].severity, 4)
  resetInspectionProfile()
  const name = importProfileXml(xml, { fallbackName: 'RoundTrip', activate: true })
  // XML 里写的是 myName="Default"（不是我传的 fallback），撞名按上游「另存一份」的规矩加后缀。
  assert.equal(name, `${DEFAULT_PROFILE_NAME} (导入)`)
  assert.equal(applyInspectionProfile('eslint', 2, 'quotes'), null, '导入后同一把键照旧生效')
  resetInspectionProfile()
  resetInspectionTool('eslint::quotes')
})

test('消费链路：聚合门控与面板都走身份键（不是只过自己测试的死模块）', () => {
  const problems = read('src/problems.ts')
  assert.match(problems, /applyInspectionProfile\(item\.source \?\? '', item\.severity, item\.code, item\.tags\)/,
    'LSP 那一支把 code/tags 一起交给门控')
  assert.match(problems, /tags: item\.tags/, '问题表带着 tags 出面板')
  const panel = read('src/components/ProblemsPanel.vue')
  assert.match(panel, /inspectionItems\(props\.problems\)/, '「检查配置…」按检查项列')
  assert.ok(!panel.includes('profileSources'), '旧的按检查器列的清单已经换掉，不留两套')
  assert.match(panel, /value="inspection"/, '分组下拉有「按检查项」这一档')
  assert.match(panel, /kindChip\(p\)/, '行上画「未使用 / 已废弃」芯片')
  assert.match(panel, /muteKeys: groupMute\.value \? muteKeysFor\(group\) : \[\]/,
    '组头没有走「停用键集合」（面板 → src/problemsView.ts 的 groupMuteKeys）')
  assert.match(read('src/problemsView.ts'), /const key = identityOfRow\(row\)\.key/,
    '组头的停用键要从身份解析来，与门控同一把（搬进纯函数后锚点跟着搬）')
  const state = read('src/problemsPanelState.ts')
  assert.match(state, /PROBLEM_GROUPINGS/, '存档白名单直接取分组档清单（漏一档就会静默退回不分组）')
})
