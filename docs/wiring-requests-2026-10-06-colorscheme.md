# 接线请求 · colorscheme 桶 · 2026-10-06

本桶交付 `src/colorScheme.ts` / `src/colorSchemeStore.ts` / `src/components/ColorSchemeSettingsPage.vue`
（Editor ▸ Color Scheme 整页，判词 `docs/inventory/verdict-editor.md` §C-4 缺口③）。
三个文件的消费链已在本桶内闭合（页面当场消费两个模块），但**设置树挂载点在别的代理正在改的保留文件里**，
按规约 §2 交可照抄的整段。行号是**撰写时**的（以锚文本为准，粘贴前先重读目标文件）。

---

## W-1 把页面挂进设置树（SettingsDialog.vue + settingsTreeMeta.ts）

### 1.1 `src/settingsTreeMeta.ts`

**(a) 第 10-11 行的 lucide import 里加 `Paintbrush`**（已在 `node_modules/lucide-vue-next` 核实存在）。
撰写时第 10 行：

```ts
  AlignLeft, Braces, Bug, Cog, Eye, FileType, Filter, FoldVertical, GitBranch, GitCommitIcon, Hammer, History, Keyboard,
```

改成：

```ts
  AlignLeft, Braces, Bug, Cog, Eye, FileType, Filter, FoldVertical, GitBranch, GitCommitIcon, Hammer, History, Keyboard, Paintbrush,
```

**(b) 第 37 行 `PageKey` 联合类型**，在 `'editor.preferences.folding'` 之后加一支（键名直接沿用上游 configurable id，
这是本文件头的既有约定「页面键尽量直接沿用 IDEA 的 configurable id」）：

```ts
export type PageKey = 'preferences.lookFeel' | 'editor' | 'editor.preferences.appearance' | 'editor.preferences.tabs' | 'editor.preferences.smartKeys' | 'editor.preferences.gutterIcons' | 'editor.preferences.folding'
  // Color Scheme：`platform/platform-impl/resources/intellij.platform.ide.impl.xml:1749-1751`
  // （`groupId="editor" groupWeight="180" instance=ColorAndFontOptions id="reference.settingsdialog.IDE.editor.colors"`）
  | 'reference.settingsdialog.IDE.editor.colors'
  | 'advanced'
```

**(c) 节点表**：撰写时第 105 行是 `editor.preferences.gutterIcons` 节点、第 106 行是
`// preferences.sourceCode groupWeight=170（intellij.platform.lang.impl.xml:987）` 注释。
**在这两行之间**插入（180 > 170 ⇒ 排在「代码风格」前，与上游编辑器组的权重序一致）：

```ts
  // Color Scheme（`intellij.platform.ide.impl.xml:1749-1751`：groupId="editor" groupWeight="180"
  // id="reference.settingsdialog.IDE.editor.colors" key="title.colors.and.fonts"）。
  // 方案列表/继承、逐档色块、搜索、重置都在页面里；行级字体样式与彩虹档未渲染（通道缺口见
  // 本页文件头与 src/colorScheme.ts 文件头）。
  { key: 'reference.settingsdialog.IDE.editor.colors', label: '配色方案', icon: Paintbrush, parent: 'group:editor',
    keywords: '配色 方案 颜色 语法 前景 背景 光标 选区 行号 color scheme colors syntax caret selection' },
```

### 1.2 `src/components/SettingsDialog.vue`

**(a) import**（撰写时第 37 行 `import KeymapSettingsPage ...` 之后）：

```ts
import ColorSchemeSettingsPage from './ColorSchemeSettingsPage.vue'
```

**(b) 挂载 section**：撰写时第 800 行附近是

```
<section v-show="section === 'editor.preferences.folding'" …>
```

**在它前面**插入整段（props 只有一格 `busy`；页面自带保存通道，不需要对话框「应用」联动）：

```html
        <section v-show="section === 'reference.settingsdialog.IDE.editor.colors'" :id="`${id}-panel-reference.settingsdialog.IDE.editor.colors`" class="settings-panel" data-page="reference.settingsdialog.IDE.editor.colors" role="tabpanel" :aria-labelledby="`${id}-tab-reference.settingsdialog.IDE.editor.colors`" :aria-busy="busy">
          <ColorSchemeSettingsPage :busy="busy" />
        </section>
```

**(c) 挂上之后**：`.tools/orphan-baseline.txt` 里本桶登记的那行
（`src/components/ColorSchemeSettingsPage.vue # 挂载点在 SettingsDialog.vue…`）可以删——
门禁会在「已接上」里提示（该文件是 git-ignore 的工作区基线，改动只影响本机门禁口径）。

---

## W-2 行级字体样式 + 彩虹档的「变量化」通道（决定本页能不能长出这些行）

上游每个颜色项带 前景/背景/粗体/斜体/删除线/效果线（证据
`platform/platform-impl/src/com/intellij/application/options/colors/ColorAndFontDescriptionPanel.kt:107-108,120-121`）
与彩虹括号档（`platform/platform-impl/src/com/intellij/application/options/colors/RainbowDescriptionPanel.java`）。
本仓对应字面量**不是 var 驱动**，页面按假控件禁令没画这些行。要长出来需要（保留文件，交请求）：

1. `src/editorTheme.ts:17-19`：`fontWeight: '600'` → `fontWeight: 'var(--scheme-keyword-weight, 600)'`，
   注释档 `fontStyle: 'italic'` → `var(--scheme-comment-font-style, italic)`；
2. `src/editorSemanticColors.ts:26,31`：同上两个字面量（语义层的 key/注释档）；
3. `src/editorBrackets.ts:117-126`：五档硬编码 hex → `var(--rainbow-0..4)`，并在 `src/tokens.css`
   （主代理独占）给两套主题各补五个具名值（值抄现 hex，坐标即本文件行号）；
4. 之后在 `src/colorScheme.ts` 的 `COLOR_ATTRIBUTE_ITEMS` 加行 + `ColorScheme` 的覆盖表加样式位，
   页面自动长控件（渲染面已留好：行模板只认 `cssVar`）。

## W-3 启动期全局应用存档方案（App.vue，appvue 代理独占）

现状：页面被渲染时（打开设置）`onMounted` 会 `applyColorScheme(state)`，每次改动即时持久+生效；
但**应用启动后、打开设置前**，编辑器还是基座 tokens。上游是启动期 `EditorColorsManager`
直接把全局方案灌进每个编辑器（`platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColorsManager.java:44,50`）。
照抄段（App.vue 主题初始化完成后调用一次即可；深浅切换**不需要**再调——注入样式自带
`:root[data-theme='…']` 限定）：

```ts
import { applyColorScheme, loadColorSchemeState } from './colorSchemeStore.ts'

// 主题/文档就绪后一次：
applyColorScheme(loadColorSchemeState())
```

## W-4 上游挂载点里没画的两族按钮（导入 / 文件导出）——需要宿主通道再议

`ColorSchemeExporter.java:9`（导出为 .icls 文件）与 `ColorSchemeImporter` 需要**文件保存/打开**宿主通道；
页面目前只有剪贴板降级（「复制方案 XML」）。若 bridge 已有/将加「保存文本到用户选的路径」，页面侧一行接上即可
（`schemeToXml` 的形状已在 `tests/color-scheme-rules.test.mjs` 钉死）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W-1（把 `ColorSchemeSettingsPage.vue` 挂进设置树）跳过** —— 目标 `src/settingsTreeMeta.ts`（`PageKey` 联合 + `SETTINGS_NODES` + `PAGE_KEYS` + lucide import）**不在本 lane 可改面**（lane 所有权只含 `src/App.vue` / `src/components/**`（除四文件）/ `src/menus/**`）。`SettingsDialog.vue` 的 section 挂载点虽属本 lane，但 `SettingsDialog.vue` 的 `section` 键必须先在 `settingsTreeMeta.ts` 注册（`tests/settings-tree-parity.test.mjs` 会核），单挂 section = 跳转打开空页。**需 settings-tree owner** 处理（本 lane 复核：`src/components/ColorSchemeSettingsPage.vue` 仍是 orphan，`grep ColorSchemeSettingsPage src/` 只命中自身）。
- **W-2（行级字体样式变量化）** —— 目标 `src/editorTheme.ts` / `editorSemanticColors.ts` / `editorBrackets.ts` / `tokens.css`（均非本 lane）。跳过。
- **W-3（启动期应用存档方案）未落** —— 目标 `src/App.vue`（本 lane 可改），但依赖 W-2 的变量通道才有视觉差异；且 `applyColorScheme` 的启动期调用会影响全局主题（需谨慎）。登记为「等 W-2 通道」。
- **W-4（导入/导出按钮）** —— 需 bridge 文件通道，非本 lane。

结论：零接线（W-1 被 settingsTreeMeta 挡住转 owner）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（W-1 被 settingsTreeMeta 挡住转 owner）。」。
本 lane 本轮接线：**W-3 已接** —— `src/App.vue` 的 `onMounted` 里加了 `applyColorScheme(loadColorSchemeState())`（import 在 `:96` 附近），启动期把存档配色灌进文档一次（注入样式自带 `:root[data-theme]` 限定，深浅切换无需再调）。W-1（挂设置树）需 `src/settingsTreeMeta.ts` owner；W-2 需 editorTheme/editorBrackets/tokens.css owner；W-4 需 bridge 文件通道。
