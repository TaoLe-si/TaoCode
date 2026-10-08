// 判据 · lp/inspections 的**检查器描述富文档**（`InspectionDescriptionDocumentationProvider` 一族）。
//
// 钉三件事：
//   ① `stripInspectionDescription` 与上游 `InspectionNodeInfo.stripUIRefsFromInspectionDescription`
//      （`InspectionNodeInfo.java:130-136`）逐字等价：切在 `<!-- tooltip end -->`、没有标记原样返回；
//   ② `inspectionDescriptionFor` 只对**本地内置**检查器出说明（按短名查），
//      语言服务的规则名查不到就返回 null（不编通用文案 —— 上游 `generateDoc` 也是 null）；
//   ③ 本地内置表的键**都能在 `src/junitInspections.ts` 的源码里找到**（短名不许是编的）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  LOCAL_INSPECTION_DESCRIPTIONS,
  hasInspectionDescription,
  inspectionDescriptionFor,
  stripInspectionDescription,
} from '../src/inspectionDescription.ts'

test('stripInspectionDescription：切在 <!-- tooltip end -->，没有标记原样返回', () => {
  const html = '<p>正文</p><!-- tooltip end --><p>UI 引用</p>'
  assert.equal(stripInspectionDescription(html), '<p>正文</p>')
  assert.equal(stripInspectionDescription('<p>只有正文</p>'), '<p>只有正文</p>')
  assert.equal(stripInspectionDescription(''), '')
})

test('本地内置表：键是上游检查类短名，且都能在 junitInspections.ts 里找到', () => {
  const source = readFileSync('src/junitInspections.ts', 'utf8')
  for (const shortName of Object.keys(LOCAL_INSPECTION_DESCRIPTIONS)) {
    assert.ok(source.includes(shortName), `本地说明表里的 ${shortName} 在 src/junitInspections.ts 里找不到 —— 键不许是编的`)
  }
})

test('inspectionDescriptionFor：按短名/全名/诊断码命中，显示名与正文都在', () => {
  const byShort = inspectionDescriptionFor('JUnitIgnoredTestInspection')
  assert.ok(byShort)
  assert.equal(byShort.displayName, '被忽略的测试没有说明原因')
  assert.match(byShort.content, /@Ignore/)
  // 带包名的全名取末段。
  assert.deepEqual(inspectionDescriptionFor('com.intellij.JUnitIgnoredTestInspection'), byShort)
  // 诊断码那一栏也能命中（本仓把本地规则短名放在 code/source 两处之一）。
  assert.deepEqual(inspectionDescriptionFor(null, 'ParameterizedParametersStaticCollectionInspection'), LOCAL_INSPECTION_DESCRIPTIONS.ParameterizedParametersStaticCollectionInspection)
})

test('inspectionDescriptionFor：语言服务规则名查不到就返回 null（不编通用说明）', () => {
  assert.equal(inspectionDescriptionFor('eslint', 'no-unused-vars'), null)
  assert.equal(inspectionDescriptionFor('tsc', 2322), null)
  assert.equal(inspectionDescriptionFor(undefined, undefined), null)
  assert.equal(inspectionDescriptionFor('', ''), null)
  assert.equal(hasInspectionDescription('eslint', 'no-unused-vars'), false)
  assert.equal(hasInspectionDescription('JUnitIgnoredTestInspection'), true)
})
