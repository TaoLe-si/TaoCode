// 配色方案设置页的**注册参数** —— 上游 `ColorAndFontOptions` 的对应物。
//
// 出处（参考树逐行核过）：
//   · 注册行：`platform/platform-impl/resources/intellij.platform.ide.impl.xml:1749-1752`
//     `<applicationConfigurable groupId="editor" groupWeight="180" dynamic="true"
//        instance="…ColorAndFontOptions"
//        id="reference.settingsdialog.IDE.editor.colors" key="title.colors.and.fonts"
//        bundle="messages.ApplicationBundle"/>`
//   · ID 常量：`…/colors/ColorAndFontOptions.java:117`
//     `public static final String ID = "reference.settingsdialog.IDE.editor.colors";`
//   · 标题：`platform/ide-core/resources/messages/ApplicationBundle.properties:524`
//     `title.colors.and.fonts=Color Scheme`
//
// 本仓没有 EP 宿主把 `instance` 反射成组件 ⇒ 注册落到 `src/settingsTreeMeta.ts`（键表）
// 与 `src/components/SettingsDialog.vue`（渲染点），本文件给出**可照抄的那两行**所需要的一切。

/** 上游 `ColorAndFontOptions.java:117`。 */
export const COLOR_SCHEME_SETTINGS_ID = 'reference.settingsdialog.IDE.editor.colors'
/** 上游 `intellij.platform.ide.impl.xml:1749` 的 `groupId="editor"`。 */
export const COLOR_SCHEME_SETTINGS_GROUP = 'editor'
/** 同行 `groupWeight="180"`（编辑组内排序：字体页 188 > 配色 180 > 其它）。 */
export const COLOR_SCHEME_SETTINGS_GROUP_WEIGHT = 180
/** `…xml:1750` `dynamic="true"`：EP 变了不用重开设置对话框。 */
export const COLOR_SCHEME_SETTINGS_DYNAMIC = true
/** `ApplicationBundle.properties:524`（本仓界面中文，标题用「配色方案」）。 */
export const COLOR_SCHEME_SETTINGS_LABEL = '配色方案'

/**
 * `src/components/ColorSchemeSettingsPage.vue:52` 的 props 契约：
 * 只有 `busy?: boolean` —— 数据自己 `loadColorSchemeState()`，不由父传。
 * 所以 `SettingsDialog.vue` 的挂载行**不需要**任何数据 prop，只透传 `busy`。
 *
 * 接线落点（本仓两个保留文件各加一行；`SettingsDialog.vue` 只剩 1 行余量，先腾再写）：
 * ① `src/settingsTreeMeta.ts`：PageKey 联合追加 `reference.settingsdialog.IDE.editor.colors`；
 *    SETTINGS_NODES 里 `editor.breadcrumbs` 那行之前插——上游 groupWeight 180 排在 breadcrumbs 188 之前。
 * ② `src/components/SettingsDialog.vue`：`editor.stickyLines` 那个 section 之后加一行（组件 + busy 透传）。
 * ③ 腾行：把「编辑器 › 常规」那一节（约 40 行）拆到 EditorGeneralSettingsPage.vue
 *    （照 `AudioCuesSettingsPage.vue` 的最小样板），净释放约 35 行，足够接①②。
 */

/** 出厂方案差异（对账用）：上游 `projectModel-impl.xml:34-39` 有 6 个 bundled + `DefaultColorSchemesManager.xml` 的 Default/Darcula，
 *  另有 9 个可选插件方案（`plugins/color-schemes/星/resources/META-INF/plugin.xml:13`（`*` 通配各子目录））；
 *  本仓 `colorSchemeStore.ts` 的 `BASE_COLOR_SCHEMES` 只有 TaoCode Light / TaoCode Dark 两个 ——
 *  用户自建方案从这两个派生（`ensureEditableScheme`），与上游「复制一份再改」同一策略，数量差如实登记。 */
export const UPSTREAM_BUNDLED_SCHEME_NAMES = Object.freeze([
  'Default', 'Darcula', 'IntelliJ Light', 'Light', 'Dark', 'Darcula Contrast', 'High contrast', 'Islands Dark',
] as const)
