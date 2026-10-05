// dm/inspections 的判据：本地检查配置文件（上游 `InspectionProfile` 的逐工具启用/严重度覆盖）。
// 落点：`src/inspectionProfile.ts` 的模型 + `src/problems.ts` 聚合前的门控。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyInspectionProfile, inspectionItems, inspectionProfile, resetInspectionProfile, resetInspectionTool,
  setInspectionToolEnabled, setInspectionToolSeverity, toolSettingFor,
} from '../src/inspectionProfile.ts'

const root = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const row = (source, severity = 2) => ({ path: 'a.ts', line: 0, character: 0, severity, message: 'm', source })

test('默认档：未登记的检查器一律启用 + 不覆盖严重度', () => {
  resetInspectionProfile()
  assert.deepEqual(toolSettingFor('eslint'), { enabled: true, severity: null })
  assert.equal(applyInspectionProfile('eslint', 2), 2)
})

test('停用一个检查器：该 source 的诊断不落表，其他不受影响', () => {
  resetInspectionProfile()
  setInspectionToolEnabled('eslint', false)
  assert.equal(applyInspectionProfile('eslint', 2), null)
  assert.equal(applyInspectionProfile('jdt', 2), 2)
  assert.deepEqual(inspectionProfile.value.tools.eslint, { enabled: false, severity: null })
  resetInspectionProfile()
})

test('严重度覆盖生效；恢复默认后回服务端原值', () => {
  resetInspectionProfile()
  setInspectionToolSeverity('jdt', 1)
  assert.equal(applyInspectionProfile('jdt', 3), 1)
  setInspectionToolSeverity('jdt', null)
  assert.equal(applyInspectionProfile('jdt', 3), 3)
  assert.equal(inspectionProfile.value.tools.jdt, undefined, '启用 + 不覆盖 = 不落存储')
  setInspectionToolEnabled('jdt', false)
  resetInspectionTool('jdt')
  assert.deepEqual(toolSettingFor('jdt'), { enabled: true, severity: null })
  resetInspectionProfile()
})

test('非法严重度不写进 profile（坏值回默认）', () => {
  resetInspectionProfile()
  setInspectionToolSeverity('x', 99)
  assert.deepEqual(toolSettingFor('x'), { enabled: true, severity: null })
  resetInspectionProfile()
})

// 清单已经升到检查项粒度（只按 source 的旧清单会把不同诊断码合并成一条，掩盖了面板真正画的东西），
// 判据保持原形状：按身份计数、空身份归到「（无来源）」、条数降序。
test('清单：按检查项计数，空来源归到「（无来源）」，按条数降序', () => {
  resetInspectionProfile()
  const list = inspectionItems([row('eslint'), row('eslint', 1), row(''), row('jdt', 3)])
  assert.deepEqual(list.map(entry => [entry.label, entry.count]), [['eslint', 2], ['（无来源）', 1], ['jdt', 1]])
  assert.equal(list[0].source, 'eslint')
  assert.deepEqual(list[0].setting, { enabled: true, severity: null })
  resetInspectionProfile()
})

test('消费链：problems.ts 按 profile 门控（停用丢行、覆盖改严重度）', () => {
  const source = read('src/problems.ts')
  assert.match(source, /applyInspectionProfile/)
  assert.match(source, /const severity = applyInspectionProfile/)
  assert.equal([...source.matchAll(/applyInspectionProfile\(item\.source \?\? ''/g)].length, 2)
})
