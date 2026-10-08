# Lane `pf-actions`（platform_rest：pf/actions + lp/ide-actions + se/ui + se/providers + ss/matcher）· 2026-10-08

## 做了什么

1. **修绿本 lane 名下的既有红**（基线 `build/_baseline-fails.txt`：`menukeys-probe`）：`src/menus/codeMenu.ts:6`
   与 `src/saveAsTemplateHost.ts:1` 是两处**无扩展名的相对 import**（`'../saveAsTemplateHost'` / `'./saveAsTemplate'`），
   node ESM 解析整片失败 ⇒ `node --test tests/menukeys-probe.test.mjs` 一条都跑不起来（0/4）。补 `.ts` 后 **4/4 绿**。
   （`action-registry`/`keymap-bindings` 两条基线红在我开工时已由前序批次修绿，本 lane 复跑确认。）
2. **pf/actions：`UIToggleActions` 逐条收口**（`PlatformActions.xml:536-547`）——补两条真实入口：`view.presentationAssistant`
   （`:538`）与 `view.mainMenuMode.hamburger|merged|separate`（`:541` 的三档单选）。不生成的：`ViewMainMenu`（`:540`，上游
   `ViewMainMenuAction.java:33-38` 的 `!isNewUI()` ⇒ 新 UI 下不适用）、`ViewNewToolbarAction`/`ViewObsoleteToolbarAction`/
   `ViewToolbarActionsGroup`（`:542-544`，本仓无工具栏宿主）。同时**订正三处假注释**（注释与磁盘不符）：
   `src/menus/viewMenu.ts:139`（`ViewToolButtons` 消费者写错成 `src/toolWindowStripes.ts`，该键在那边零命中，真消费者是
   `src/appearanceActions.ts:235-237` 的 `html[data-tool-stripes]` + `src/style.css:43`）、`src/actionRegistry.ts` 与
   `src/menus/types.ts` 的 `icon` 注释（原写「渲染层未接」，实况：主菜单已接 `src/App.vue:94/2088/2095/2100`，只有
   `src/menuUi.ts` 的面板行无图标位）、`src/copyPathActions.ts:8-9`（标签右键原写「只有一条复制路径」，实况是整组）。
3. **ss/matcher：模板合法性补了词法那一半**（新模块 `src/structuralSearchValidity.ts`）——括号配对 / 字符串闭合 /
   块注释闭合；`$Name$` 与它的约束后缀整段掩掉（后缀里的 `regex(\d+)`、`[a-z]` 是约束自己的语法）。接线在
   `src/structuralSearchPanelModel.ts` 的 `compileTemplate()` **第一道**（不合法 ⇒ `compiled` 也为 null）。PSI 语法树
   那一半仍缺（如实，不假装）。`$Args$` 一族核实为**已有落点**（`src/structuralCodeBlock.ts` 的 `listRunStartsHere`/
   `listRunEndsHere` + `src/structuralSearchModifiers.ts` 的 `listRunVerdict`）。
4. **lp/ide-actions 复核（未改代码）**：复制路径/引用**三处宿主已全接**（`src/App.vue:1590`、`src/components/SearchPanel.vue:177-188`、
   `src/components/SourceControl.vue:224-256`、`src/components/TabContextMenu.vue`）；SelectIn 端到端链路在
   `src/selectIn.ts` + `src/selectInTargets.ts` + `src/editorSideViews.ts:185-199`；「另存为模板」那条「缺」已不成立
   （`src/saveAsTemplate.ts` + `src/saveAsTemplateHost.ts` + `src/menus/codeMenu.ts:69` 的 `code.saveAsTemplate`）。
5. **`presence=='真实代码'` 71 行逐条核**（python 切片）：70 行有同名/近名落点（源码或判据里 grep 得到），
   唯一需要手工确认的 `ImportSettingsFilenameFilter` 落点在 `src/settingsTransfer.ts:31-35,66-72,77-79`（`SETTINGS_ARCHIVE_FILTERS`/
   `archivePathProblem`/`ensureArchiveExtension`，消费于 `:159-160`、`:188-190`）⇒ 71/71 成立。
6. **判决回填**：`scripts/verdict_table.py` 五个族键各**追加**一段 `2026-10-08 lane pf-actions：…`
   （不删历史段），`python scripts/verdict_table.py platform_rest` 已重生成。

## 落点文件

- 新增：`src/structuralSearchValidity.ts`（129 行）、`tests/main-menu-mode-actions.test.mjs`、`tests/structural-search-validity.test.mjs`
- 修改：`src/menus/viewMenu.ts`（6 行新行 + 3 处注释）、`src/menus/types.ts`、`src/actionRegistry.ts`、`src/copyPathActions.ts`（注释订正）、`src/structuralSearchPanelModel.ts`（import + `compileTemplate()` 第一道）、`src/menus/codeMenu.ts`、`src/saveAsTemplateHost.ts`（import 扩展名）、`tests/view-toggle-actions.test.mjs`（消费者断言订正 + 1 条新判据）、`scripts/verdict_table.py`、生成物 `docs/inventory/platform_rest_verdict_table.json` / `verdict-platform_rest.md`
- **未碰**任何禁改文件（`git status` 核实：App.vue / bridge.ts / main.cpp / DebugPanel.vue / SourceControl.vue / CodeEditor.vue / DiffView.vue 无我的改动）

## 判据与条数（我新增/修改的）

| 判据文件 | 条数 | 内容 |
|---|---|---|
| `tests/main-menu-mode-actions.test.mjs`（新） | 6 | 三档行/文案与设置页同源、单选语义、真实消费者（`data-main-menu` + CSS 分档 + 顶栏图标）、`ViewMainMenu` 不生成、macOS 整组不生成、上游出处行 |
| `tests/structural-search-validity.test.mjs`（新） | 6 | 内建模板全集放行、三种括号错误带定位、引号/块注释、变量与后缀不算代码、面板模型接线、上游出处行 |
| `tests/view-toggle-actions.test.mjs`（改） | 4（+1 条新，1 条订正） | 新增 `view.presentationAssistant` 翻转活状态；原「真实消费者」那条原来匹配的是**另一个**设置 `showToolWindowNames`（恒绿），改成真消费者 + 反证 |
| `tests/menukeys-probe.test.mjs` | 4 | 由 0/4（解析失败）修到 4/4 |

**反向验证（各做一次，改坏 ⇒ 必须红，再恢复）**：① `checkTemplateValidity` 短路成恒 `ok` ⇒ 4 条红；② 去掉
`view.mainMenuMode.merged` 的单选守卫 ⇒ 该条红；③ 抽掉 `view.presentationAssistant` 行 ⇒ 该条红。恢复后复跑全绿。

## 门禁读数（实测）

- `node --test tests/action-registry.test.mjs tests/keymap-bindings.test.mjs tests/search-everywhere.test.mjs` → `tests 47 / pass 47 / fail 0`
- `node --test tests/module-size.test.mjs` → `tests 5 / pass 5 / fail 0`
- `node --test tests/verdict-generated.test.mjs` → `tests 5 / pass 5 / fail 0`
- `npx vue-tsc --noEmit` → **EXIT=0**（无输出）
- 分批复跑：action+ide-actions 9 文件 **75/75**；structural-search 6 文件 **74/74**；search-everywhere 6 文件 **75/75**；菜单族 3 文件 **29/29**；相邻门禁 5 文件 **30/30**；`python scripts/verdict_table.py platform_rest` → `total=20574 [x]=167 [~]=5305 [ ]=0 [-]=15102`

## 族档位变化

**无（五族都留 `~`）**，理由如实：
- `pf/actions`：卡在 `Switcher`（Ctrl+Tab 弹窗宿主在禁改 `src/App.vue`）、`ActionsOnSave` 其余三段的可持久化开关
  （要同时改 `native/settings_schema.*` 与禁改的 `src/bridge.ts` general 补丁白名单）、工具栏视图模式（无宿主通道）。
- `lp/ide-actions`：卡在 `SaveAsAction` 的对话框、代码风格方案模型、包语义新建的 App.vue 入口按钮、`ExternalJavaDocAction`。
- `se/ui` + `se/providers`：只剩两条且都非漏抄（不收集遥测；第三方「交一个实现类」的 contributor 通道没有宿主）。
- `ss/matcher`：卡在没有 PSI（语法树级合法性、脚本/引用约束、arrangement 重排）。

## 仍缺什么（如实）

- `ViewStatusBarWidgetsGroup`（`:547`）那批开关本仓只在「查找操作」里（`src/statusWidgets.ts` 的 `widgetToggleRows`，消费 `src/menuUi.ts:287-291`）；View 菜单内联组要补得先给 `WidgetToggleRow` 加 checked 态 —— **本 lane 未做**。
- 上游 `KeepPopupOnPerform.IfRequested`（`ChangeMainMenuModeActionGroup.kt:26`）本仓**无宿主字段**（`MenuRow` 没有 keepPopup），点一下收起弹层 —— 不假装支持。
- 模板合法性只有词法层；已知假阴性：`#` 在 CSS 里是颜色不是注释（`#fff` 之后同一行不参与检查，只可能漏报）。`SetShortcutAction` 的「从动作起手分配键位」入口、`QuickChangeCodeStyleSchemeAction`、`SearchEverywhereClassifier`/PSI 渲染仍缺。

## 需要协调代理接线的清单

本 lane 的改动**不需要**动禁改文件（新行都在 `createViewMenuRows` 内，宿主已把 `editorSettings`/`saveSettingsPatch` 经 ctx 传入；
写盘路径实测存在：`src/App.vue:703` 的 `saveSettingsPatch` → `settings.update` → `native/settings_schema.hpp:25` 白名单 +
`settings_schema.cpp:98-101` 值校验 + `:393` 默认档）。只有要做下面两项才需要协调代理：
1. `ViewStatusBarWidgetsGroup` 进 View 菜单：`src/statusWidgets.ts:292-304` 的 `WidgetToggleRow` 补 `checked`，`src/menus/viewMenu.ts` 加 `childrenOf`；渲染侧不用改（App.vue 已按 `child.checked()` 画勾）。
2. `keepPopup`：`src/menus/types.ts` 加字段 + `src/App.vue` 的 `pickMenuRow` 分支（禁改文件），否则不做。
