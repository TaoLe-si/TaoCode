// 受信任项目（IDEA `com.intellij.ide.trustedProjects`）的判据：
//   · 纯逻辑（路径归一 / 最近祖先 / 清单增改 / 拦截文案）在 src/trustedProjects.ts；
//   · 存储四处登记（native 键表 + 默认值 + 校验 + 预览白名单）与执行门（native/trusted_paths.cpp、
//     runActions 的 trustBlock）用源码断言钉住 —— 这几处任何一处漏了，功能就是"看着有、其实不挡"。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  TRUST_BUTTONS, TRUST_REMEMBER_LABEL, isPathInside, isProjectTrusted, mergeTrustEntries,
  needsTrustPrompt, normalizeTrustedPath, rememberTrust, trustBlockReason, trustBlockedMessage,
  trustedStateFor,
} from '../src/trustedProjects.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('路径归一：正斜杠 / 去尾斜杠 / 小写；盘符根不被削成前缀', () => {
  assert.equal(normalizeTrustedPath('D:\\Work\\Demo\\'), 'd:/work/demo')
  assert.equal(normalizeTrustedPath('  C:/Root  '), 'c:/root')
  assert.equal(normalizeTrustedPath('C:/'), 'c:/')
  assert.equal(normalizeTrustedPath('/home/me/proj//'), '/home/me/proj')
})

test('落在里面按路径段判：/a/bc 不在 /a/b 里，相等算自身', () => {
  assert.equal(isPathInside('d:/work/demo', 'd:/work/demo'), true)
  assert.equal(isPathInside('d:/work/demo/src', 'd:/work/demo'), true)
  assert.equal(isPathInside('d:/work/demo2', 'd:/work/demo'), false)
  assert.equal(isPathInside('d:/work', 'd:/work/demo'), false)
})

test('最近祖先优先：显式不信任胜过更短的显式信任（上游取 nameCount 最大的条目）', () => {
  const entries = [
    { path: 'D:/work', trusted: true },
    { path: 'D:/work/secret', trusted: false },
  ]
  assert.equal(trustedStateFor('D:/work/demo', entries), 'trusted')
  assert.equal(trustedStateFor('D:/work/secret', entries), 'untrusted')
  assert.equal(trustedStateFor('D:/work/secret/deep', entries), 'untrusted')
  assert.equal(trustedStateFor('D:/other', entries), 'unknown')
  assert.equal(isProjectTrusted('D:/work/demo', entries), true)
  assert.equal(isProjectTrusted('D:/work/secret/deep', entries), false)
  assert.equal(isProjectTrusted(undefined, entries), false)
})

test('清单增改：同一路径就地更新、其余条目不动；会话答案与持久答案合并', () => {
  const base = [{ path: 'd:/a', trusted: true }, { path: 'd:/b', trusted: false }]
  const updated = rememberTrust(base, 'D:\\A\\', false)
  assert.deepEqual(updated.map(entry => [entry.path, entry.trusted]), [['d:/b', false], ['d:/a', false]])
  assert.equal(base.length, 2, '不许原地改调用方传进来的数组')
  assert.deepEqual(mergeTrustEntries([{ path: 'd:/a', trusted: true }], [{ path: 'd:/b', trusted: false }]).length, 2)
  assert.deepEqual(mergeTrustEntries(undefined, undefined), [])
})

test('要不要弹框：只有 unknown 才问（已知信任/已知不信任都不再问）', () => {
  assert.equal(needsTrustPrompt('D:/work/demo', []), true)
  assert.equal(needsTrustPrompt('D:/work/demo', [{ path: 'd:/work', trusted: true }]), false)
  assert.equal(needsTrustPrompt('D:/work/demo', [{ path: 'd:/work', trusted: false }]), false)
  assert.equal(needsTrustPrompt('', []), false)
})

test('拦截文案：说清动作与项目，未打开项目不拦（各入口自己报 NOT_OPEN）', () => {
  const entries = [{ path: 'd:/work/demo', trusted: false }]
  const reason = trustBlockReason('构建 / 运行', 'D:/work/demo', entries, 'Demo')
  assert.match(reason ?? '', /安全模式/)
  assert.match(reason ?? '', /构建 \/ 运行/)
  assert.match(reason ?? '', /Demo/)
  assert.match(trustBlockedMessage('打开终端', 'D:/work/demo'), /D:\/work\/demo/)
  assert.equal(trustBlockReason('构建', undefined, entries), null)
  assert.equal(trustBlockReason('构建', 'D:/work/demo', [{ path: 'd:/work', trusted: true }]), null)
})

test('存储四处登记：native 键表 / 默认值 / 校验 / 预览白名单（缺一处就是静默失效）', () => {
  const header = read('native/settings_schema.hpp')
  assert.match(header, /GENERAL_SETTING_KEYS\[\] = \{[\s\S]*"trustedPaths"[\s\S]*?\};/, 'native 键表缺 trustedPaths')
  const schema = read('native/settings_schema.cpp')
  assert.match(schema, /\{"trustedPaths", Json::array\(\)\}/, 'native 默认值缺 trustedPaths')
  assert.match(schema, /it\.key\(\) == "trustedPaths"/, 'native 校验缺 trustedPaths 分支')
  // 该白名单已从 src/bridge.ts 拆到 src/bridgePreview.ts（模块化拆分，行为逐字未改）
  const bridge = read('src/bridgePreview.ts')
  assert.match(bridge, /key === 'trustedPaths'/, '预览态 settings.general.update 白名单缺 trustedPaths')
  const model = read('src/settingsModel.ts')
  assert.match(model, /trustedPaths: TrustedPathEntry\[\]/, '前端 GeneralSettingsState 缺 trustedPaths')
  assert.match(model, /trustedPaths: \[\]/, '前端默认值缺 trustedPaths')
})

test('执行侧真的接上：宿主硬边界 + runActions 的每个执行入口都过 trustBlock', () => {
  const host = read('native/main.cpp')
  assert.match(host, /trusted::require_trusted\(general_settings\(\), current_root, "构建 \/ 运行"\)/, 'run.start 没有门')
  assert.match(host, /trusted::require_trusted\(general_settings\(\), current_root, "打开终端"\)/, 'term.create 没有门')
  assert.match(host, /trusted::require_trusted\(general_settings\(\), current_root, "调试"\)/, '调试没有门')
  assert.match(read('native/trusted_paths.cpp'), /UNTRUSTED_PROJECT/, 'native 门没有可辨识的错误码')
  const actions = read('src/runActions.ts')
  for (const action of ['构建 / 运行', '构建', '运行', '调试', '外部工具']) {
    assert.ok(actions.includes(action), `runActions 的提示里缺动作「${action}」`)
  }
  assert.match(actions, /trustBlock: \(action: string\) => string \| null/, 'runActions 没有 trustBlock 依赖')
  const lifecycle = read('src/workspaceLifecycle.ts')
  assert.match(lifecycle, /needsTrustPrompt\(root, entries\)/, '打开工作区没有走信任询问')
  assert.match(lifecycle, /request<GeneralSettingsState>\('settings.general.update', \{ general: generalSettings.value \}\)/, '信任清单没有落应用级设置')
  const app = read('src/App.vue')
  assert.match(app, /<TrustedProjectDialog v-if="trustPrompt"/, '确认框没有挂进 App')
  assert.match(app, /trustBlock: action => projectTrustBlock\(action\)/, 'App 没有把 trustBlock 接给 runActions')
  assert.equal(TRUST_BUTTONS.trust.length > 0 && TRUST_REMEMBER_LABEL.length > 0, true)
})

test('确认框组件与运行侧门控的源码落点存在', () => {
  assert.ok(read('src/components/TrustedProjectDialog.vue').includes('TRUST_DIALOG_TITLE'))
  // 终端不给前端提示也能被宿主挡下（终端面板直接显示 UNTRUSTED_PROJECT 的 message）。
  assert.match(read('native/trusted_paths.cpp'), /已阻止" \+ action/)
})
