import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as vue from 'vue'

// Execute the production module, substituting only the native transport and unrelated imports.
function host(send) {
  const source = readFileSync(new URL('../src/settingsPersistence.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  new Function('require', 'exports', js)(rawName => {
    // 本仓 `.ts` 之间的值 import 必须写全扩展名（Node ESM 不猜扩展名），所以桩按「去掉 .ts」归一化匹配，
    // 两种写法都收 —— 否则源码补扩展名会让这个 CJS 桩表整体失配（症状是 `Error: ./errors.ts`）。
    const name = rawName.replace(/\.ts$/, '')
    if (name === 'vue') return vue
    if (name === './bridge' || name === './bridge.ts') return { request: send }
    if (name === './errors') return { errorMessage: error => error.message }
    if (name === './bookmarksView') return { DEFAULT_BOOKMARKS_VIEW: {} }
    if (name === './commitMessageInspection') return { resolveInspectionSettings: () => ({}) }
    if (name === './settingsDraft') return {}
    // 文件选择描述件只在 `browseStructureDir`（本文件不覆盖的动作）里用；给个形状正确的替身即可。
    if (name === './fileChooserDescriptor') return {
      chooseWithDescriptor: async (_host, _descriptor, initial) => initial ?? null,
      singleDirDescriptor: () => ({}), withTitle: descriptor => descriptor,
    }
    throw new Error(name)
  }, exports)
  let epoch = 1
  const deps = {
    settingsBusy: vue.ref(false), settingsError: vue.ref(''), projectSettings: vue.ref({ scopes: [], fileColors: [] }),
    workspace: vue.ref({ root: 'project' }), workspaceEpoch: () => epoch, notify() {},
  }
  return { ...exports.createSettingsPersistence(deps), deps, switchProject: () => epoch++ }
}
const scopes = [{ name: 'Sources', pattern: 'file:*.ts', shared: false }]
const fileColors = [{ scope: 'Sources', color: 'Blue' }]

test('scope page saves scopes and colors in one native transaction', async () => {
  const calls = []
  const h = host(async (method, patch) => {
    calls.push({ method, patch })
    return { settings: { scopes, fileColors, localFileColors: [] } }
  })
  await h.saveSettingsDraft({ scopes, fileColors })
  assert.deepEqual(calls, [{ method: 'project.settings.update', patch: { scopes, fileColors } }])
  assert.deepEqual(h.deps.projectSettings.value, { scopes, fileColors, localFileColors: [] })
})

test('file color save displays current project errors', async () => {
  const h = host(async () => { throw new Error('disk full') })
  await h.saveFileColors(fileColors)
  assert.equal(h.deps.settingsError.value, 'disk full')
  assert.equal(h.deps.settingsBusy.value, false)
})

test('late file color failure must not leak into a different project', async () => {
  let reject
  const h = host(() => new Promise((_, fail) => { reject = fail }))
  const saving = h.saveFileColors(fileColors)
  h.switchProject()
  reject(new Error('old project'))
  await saving
  assert.equal(h.deps.settingsError.value, '')
})
