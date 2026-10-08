# wiring-requests-2026-10-07-epclose — EP 化收口 lane 留给宿主/组件的挂载点

本批（EP 化收口 lane）做掉的三件事：①把「数据表/函数形态」的注册面重构成 EP 注册表（`src/extensionPoints.ts`
新增 EP 声明 + 各注册表 `register/unregister/adoptFromExtensions/find`，消费点改从注册表取）；
②补上 exec2 R3 的宿主回调注入点、runcfg4 W1 的排序比较器、plugins P-1 的模块侧入口；
③复核 wiring-requests 的误标。

**模块侧已实现**，下面每一条只差组件/宿主里的一处挂载。行号是 2026-10-07 当时的取值，接线时按内容定位。

---

## W-1 plugins P-1：`src/projectExtras.ts` 已实现，需要在 `src/App.vue` 挂两处

**模块侧已实现**：`src/projectExtras.ts` 已导出 `pluginFocusId`（ref）与 `openPluginsAndSelect(id)`
（上游 `PluginManagerConfigurableService.java:14-15` 的等价入口；定位动作是 `PluginDialog.vue` 的
`focusPlugin` prop，接收侧早已就绪）。

**需要在 `src/App.vue:979` 加**（`createProjectExtras` 解构那一行加两个键）：

```ts
  pluginOpen, pluginBusy, pluginList, installingPlugins, pluginFocusId, openPlugins, openPluginsAndSelect, togglePluginById, installPlugin, installPluginDirectory, setPluginsEnabled, uninstallPlugin, refreshPlugins, togglePlugin,
```

**需要在 `src/App.vue:2593-2594` 的 `<PluginDialog …>` 加**一个绑定与关闭清空：

```html
    <PluginDialog v-if="pluginOpen" :plugins="pluginList" :installing="installingPlugins" :busy="pluginBusy" :is-desktop="isDesktop" :focus-plugin="pluginFocusId"
      @toggle="togglePluginById" @set-enabled="setPluginsEnabled" @install="installPlugin" @install-directory="installPluginDirectory" @uninstall="uninstallPlugin" @refresh="refreshPlugins" @close="pluginOpen = false; pluginFocusId = ''" />
```

接线后 `openPluginsAndSelect('某插件 id')` 即可「打开插件页并定位」——真实调用方（通知/错误详情面）
不需要新通道，任一通知动作调它即可。

---

## W-2 exec2 R3：`src/runInstances.ts` 已实现，需要在 `src/App.vue` 注入宿主回调

**模块侧已实现**：`src/runInstances.ts` 的 `handleRunStarted`（`run.started`）在新实例选中之后调
`applyRunStartupFocus(...)` —— 判定走 `src/runStartupFocus.ts` 的 `decideRunStartupFocus`，
为真则调宿主的 `focusRunToolWindow()`。宿主未注入时**什么都不做**（不影响既有行为）。
判据 `tests/run-instance-startup-focus.test.mjs`。

**需要在 `src/App.vue` 加**（放在 `runConfigs` 解构 `:1359-1361` 之后；`focusToolWindowContent` 在 `:349`）：

```ts
import { onScopeDispose } from 'vue'                       // App.vue 已 import 过 vue，可省
import { setRunStartupFocusHost } from './runInstances'
import { runStartupFocusFlagsOf } from './runStartupFocus'
// 上游 RunContentManagerImpl.kt:439-458：新实例选中之后按配置上的两个开关决定要不要夺焦。
setRunStartupFocusHost({
  flagsFor: instance => runStartupFocusFlagsOf(runConfigs.value.find(config => config.name === instance.label)),
  focusRunToolWindow: () => focusToolWindowContent('run'),
  focusOwnerMissing: () => typeof document === 'undefined' || document.activeElement === document.body,
})
onScopeDispose(() => setRunStartupFocusHost(null))
```

（`runStartupFocus.ts` 的 `readRunStartupFocus` 已不存在，开关的真源是运行配置记录，所以 `flagsFor` 按
实例的 label 去 `runConfigs` 里查那条配置 —— 与 `src/runActions.ts:234-241` 取开关的口径一致。）

---

## W-3 runcfg4 W1：`src/runConfigTree.ts` 已实现比较器，需要在 `src/App.vue` 把 `persistRunConfigs` 传给对话框

**模块侧已实现**：`src/runConfigTree.ts` 新增「Sort Configurations」纯函数三件套
（上游 `RunConfigurable.kt:1289-1341`）：`compareRunConfigSiblings` / `sortRunConfigSiblings`
（文件夹在前且保序、普通按名、临时在后）、`runConfigSortSiblingOf`（配置 → 比较器输入）、
`canSortRunConfigNodes`（选中类型/文件夹才启用）。判据 `tests/run-config-sort.test.mjs`。

**需要在 `src/App.vue:2592` 的 `<RunConfigurationsDialog …>` 加**一个 prop（对话框侧本批已把「按选中子树重排
后整份回写」准备好，只是缺批量写口）：

```html
    <RunConfigurationsDialog v-if="runConfigsOpen" :configs="runConfigs" :draft="runConfigDraft" :busy="working"
      :persist="persistRunConfigs"
      @save="saveRunConfigFromDialog" @remove="removeRunConfigFromDialog" @select="loadRunConfigDraft" @close="runConfigsOpen = false" />
```

对话框侧（`src/components/RunConfigurationsDialog.vue`，组件 lane）在「Sort Configurations」动作里：
取选中节点 → `canSortRunConfigNodes(kinds)` 决定可用性 → 对每个选中的类型/文件夹节点把直接子节点
映射成 `RunConfigSortSibling`、调 `sortRunConfigSiblings` → 把重排后的整份 `RunConfig[]` 交给
`props.persist(next, '已按名称排序运行配置')`。

---

## W-4 filetypes F3：模型侧（`src/fileTypeOverrides.ts`）早已齐，需要在 `src/App.vue` 文件树右键菜单加子菜单

**需要在 `src/App.vue:2530-2536`**（现有「关联文件类型」子菜单之后，仍在 `treeMenu.entry.kind === 'file'` 的
`<template>` 内）加一个子菜单：

```html
          <button class="has-sub" @click="treeSubmenu = treeSubmenu === 'typeoverride' ? null : 'typeoverride'">覆盖文件类型</button>
          <template v-if="treeSubmenu === 'typeoverride'">
            <button v-if="isFileTypeOverridden(treeMenu.entry.path)" class="sub-item" @click="applyFileTypeOverride(treeMenu.entry.path, null)">还原（按扩展名判断）</button>
            <button v-for="option in overridableFileTypes()" :key="option.id" class="sub-item" @click="applyFileTypeOverride(treeMenu.entry.path, option.id)">{{ option.label }}</button>
          </template>
```

**需要在 `src/App.vue` 的 setup 加**（import 与一个动作；`notify` 已就绪）：

```ts
import { changeFileTypeOverride, isFileTypeOverridden, overridableFileTypes, overrideFailureReason, revertFileType } from './fileTypeOverrides'
// 上游 OverrideFileTypeAction.java:48-81：文件节点右键把文件按另一个类型打开（工程级文件集）。
function applyFileTypeOverride(path: string, value: string | null) {
  if (value === null) { revertFileType(path); treeMenu = null; treeSubmenu = null; return }
  const reason = overrideFailureReason(path, value)
  if (reason) { notify(reason, true); return }
  if (!changeFileTypeOverride(path, value)) notify('无法覆盖这个文件的类型。', true)
  treeMenu = null; treeSubmenu = null
}
```

（现有「关联文件类型」那格是**编辑器语言关联**，与本条不是同一件事：本条落的是持久化的
覆盖文件集 `fileTypeOverrideSets`，上游是 `OverrideFileTypeAction`/`PersistentFileSetManager`。）

---

## W-5 EP 贡献面：无组件挂载点，仅记录第三方接入方式（供插件运行时/后续 lane 参考）

本批把 7 个能力接上了扩展点宿主（`src/extensionPoints.ts` 的 `EXTENSIONS`）。第三方贡献走
`EXTENSIONS.registerExtension(<EP id>, <贡献 id>, <贡献对象>, { order })`，id 与上游 `qualifiedName` 逐字一致：

| 能力 | EP id | 消费点 | 判据 |
| --- | --- | --- | --- |
| 注解器 | `com.intellij.annotator` | `src/annotatorRegistry.ts` | `tests/annotator-extension-point.test.mjs` |
| 补全贡献者 | `com.intellij.completion.contributor` | `src/completionContributors.ts` | `tests/extension-points.test.mjs` |
| 内联提示提供者 | `com.intellij.codeInsight.inlayProvider` | `src/inlayProviderRegistry.ts` | `tests/extension-points.test.mjs` |
| 动作 | `com.intellij.action` | `src/actionRegistry.ts` | `tests/extension-points.test.mjs` |
| 自定义折叠 provider | `com.intellij.customFoldingProvider` | `src/customFoldingProviders.ts` | `tests/ep-custom-folding-provider.test.mjs` |
| 引号 handler | `com.intellij.quoteHandler` / `com.intellij.lang.quoteHandler` | `src/quoteHandlerRegistry.ts` | `tests/ep-quote-handler.test.mjs` |
| 环境键提供方 | `com.intellij.environmentKeyProvider` | `src/environmentKeyProviders.ts` | `tests/environment-key-provider-ep.test.mjs` |
| 文件类型 | `com.intellij.fileType` | `src/fileTypeRegistry.ts` | `tests/ep-file-type.test.mjs` |

（不动组件；插件运行时若有真实的 `registerExtension` 调用点，锚这些 id 即可被对应消费点收编。）
