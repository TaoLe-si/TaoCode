// dm/inspections 判词里「profile 的导入/导出（.xml）」那条缺的判据。
// 组件本身不可在 node --test 里渲染，所以分两半钉：
//   · 桥那一层（src/inspectionProfileHost.ts）用假 send 驱动 —— workspace.files 的返回形状
//     是 `{ files: string[] }`，而 ProfileDiskDeps.list 要 `{ path }[]`，这个映射必须真跑一遍；
//   · 面板那一层钉源码锚点，确认按钮接的是真实落盘函数而不是空壳。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bridgeProfileDiskDeps } from '../src/inspectionProfileHost.ts'

const root = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

test('桥层：workspace.files 的 string[] 映射成 { path }[]，并去掉前导 ./', async () => {
  const sent = []
  const deps = bridgeProfileDiskDeps(async (method, params) => {
    sent.push([method, params])
    if (method === 'workspace.files') return { files: ['./.taocode/inspectionProfiles/a.xml', 'src/x.ts'] }
    return null
  })
  const files = await deps.list()
  assert.deepEqual(files, [
    { path: '.taocode/inspectionProfiles/a.xml' },
    { path: 'src/x.ts' },
  ])
  assert.equal(sent[0][0], 'workspace.files')
})

test('桥层：create/read/write 三个通道的载荷形状（file.create 的 directory 只在要目录时带）', async () => {
  const sent = []
  const deps = bridgeProfileDiskDeps(async (method, params) => {
    sent.push([method, params])
    if (method === 'file.read') return { content: '<profile/>', version: 'v7' }
    return null
  })
  await deps.create('.taocode/inspectionProfiles', true)
  await deps.create('.taocode/inspectionProfiles/a.xml')
  const readBack = await deps.read('.taocode/inspectionProfiles/a.xml')
  await deps.write('.taocode/inspectionProfiles/a.xml', '<profile/>', readBack.version ?? '')

  assert.deepEqual(sent[0], ['file.create', { path: '.taocode/inspectionProfiles', directory: true }])
  // 建文件时**不带** directory 键 —— 桥那边按有没有这个键判目录/文件。
  assert.deepEqual(sent[1], ['file.create', { path: '.taocode/inspectionProfiles/a.xml' }])
  assert.equal(sent[2][0], 'file.read')
  // 写是 CAS：expectedVersion 必须原样传下去。
  assert.deepEqual(sent[3], ['file.write', { path: '.taocode/inspectionProfiles/a.xml', content: '<profile/>', expectedVersion: 'v7' }])
})

test('接线：面板「检查配置…」弹层里真有导入/导出/切档三个入口，且接的是落盘函数', () => {
  const panel = read('src/components/ProblemsPanel.vue')
  assert.match(panel, /importProfileFromProject/)
  assert.match(panel, /exportProfileToProject/)
  assert.match(panel, /selectProfileOnProject/)
  assert.match(panel, /loadProjectProfiles\(profileDiskDeps\)/)
  assert.match(panel, /saveCurrentProfileToProject\(profileDiskDeps\)/)
  assert.match(panel, /selectProfileOnDisk\(profileDiskDeps, name\)/)
  // 落盘通道那一层不许被绕开（app.writeExportFiles 只放行 .html，写不出 profile 的 .xml）。
  const host = read('src/inspectionProfileHost.ts')
  assert.match(host, /'file\.create'/)
  assert.match(host, /'file\.read'/)
  assert.match(host, /'file\.write'/)
  // 只钉**调用**（注释里提到那条通道是说明，不算）。
  assert.doesNotMatch(host, /send(?:<[^>]*>)?\('app\.writeExportFiles'/)
})
