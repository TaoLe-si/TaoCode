// 「导航栏/面包屑是否列出成员」这条设置的**四处落位**判据。
//
// 上游（逐条读过原文）：
//   · `platform/editor-ui-api/src/com/intellij/ide/ui/UISettingsState.kt:121`
//     `var showMembersInNavigationBar: Boolean by property(true)` ⇒ **默认 true**；
//   · `platform/editor-ui-api/src/com/intellij/ide/ui/UISettings.kt:222-225` 是它的读写门面；
//   · 生效点在语言侧 provider：`java/java-impl/src/com/intellij/lang/java/JavaBreadcrumbsInfoProvider.java:125`
//     `return !UISettings.getInstance().getShowMembersInNavigationBar()`（关掉它 = 面包屑改为只显示类型层），
//     旧导航栏那一侧是 `java/java-impl/src/com/intellij/ide/navigationToolbar/JavaNavBarExtension.java:103` 与 `:107`
//     （把 `PsiClass` 成员从导航栏里滤掉）。
//   · 切换动作 `platform/navbar/frontend/src/actions/ViewNavigationBarMembersAction.java:20`
//     `setEnabledAndVisible(!ExperimentalUI.isNewUI())` —— 上游那个**动作**只在旧 UI 出现；本仓没有新旧 UI 之分，
//     所以设置项常驻，这里移植的是**设置与行为**而不是那个菜单项。
//
// 为什么单独立一条门控：本仓的设置键要同时活在四个地方（TS 类型与默认、原生 schema 的默认值、
// 原生 schema 的布尔键表、读盘白名单）。少一处就会出现「设置页能改但重启后丢」或「旧存档被判损坏」，
// 而这两者在类型检查里都是绿的（见 memory：持久化设置必须为缺失键补默认）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const KEY = 'showMembersInNavigationBar'

test('类型声明与默认值都在（默认 true = 上游 UISettingsState.kt:121）', () => {
  const model = read('src/settingsModel.ts')
  assert.match(model, new RegExp(`${KEY}: boolean`), '缺类型声明')
  assert.match(model, new RegExp(`${KEY}: true`), '默认值不是 true（上游默认 true）')
})

test('原生 schema 两处都登记（默认值表 + 布尔键表）', () => {
  assert.match(read('native/settings_schema.cpp'), new RegExp(`\\{"${KEY}", true\\}`), '原生默认值没登记')
  assert.match(read('native/settings_schema.hpp'), new RegExp(`"${KEY}"`), '原生布尔键表没登记')
})

test('读盘白名单放行这一键（否则设置写了读不回来）', () => {
  assert.match(read('src/previewSettings.ts'), new RegExp(`key === '${KEY}'`), '白名单没放行')
})

test('缺键补默认：旧存档没有这一键时按 true 走，不能判损坏', async () => {
  const { defaultEditorSettings } = await import('../src/settingsModel.ts')
  assert.equal(defaultEditorSettings[KEY], true)
  // 旧 projects.json 形状：整个 editorSettings 里根本没有这个键。
  const legacy = { ...defaultEditorSettings }
  delete legacy[KEY]
  const { normalizeEditorSettings } = await import('../src/bridge.ts')
  assert.equal(normalizeEditorSettings(legacy)[KEY], undefined,
    '读盘迁移不该凭空造值 —— 补默认发生在原生 schema 的默认值表那一层')
})

// 反证：上面四条正则都得是**吃得住内容**的，不能是「文件里有字就算过」。
// 做法是把真实文件里那一处键名抠掉，喂给**同一组**判据，必须每一条都判不出来。
test('反证：把键名从四处抠掉后，同一组判据一条都不成立', () => {
  const stripped = {
    'src/settingsModel.ts': read('src/settingsModel.ts').replaceAll(KEY, 'zzAbsent'),
    'native/settings_schema.cpp': read('native/settings_schema.cpp').replaceAll(KEY, 'zzAbsent'),
    'native/settings_schema.hpp': read('native/settings_schema.hpp').replaceAll(KEY, 'zzAbsent'),
    'src/previewSettings.ts': read('src/previewSettings.ts').replaceAll(KEY, 'zzAbsent'),
  }
  assert.equal(new RegExp(`${KEY}: boolean`).test(stripped['src/settingsModel.ts']), false)
  assert.equal(new RegExp(`${KEY}: true`).test(stripped['src/settingsModel.ts']), false)
  assert.equal(new RegExp(`\\{"${KEY}", true\\}`).test(stripped['native/settings_schema.cpp']), false)
  assert.equal(new RegExp(`"${KEY}"`).test(stripped['native/settings_schema.hpp']), false)
  assert.equal(new RegExp(`key === '${KEY}'`).test(stripped['src/previewSettings.ts']), false)
})

