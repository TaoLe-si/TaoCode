# 接线请求 · 2026-10-06 · 桶 8 工具窗口注册机制 / 查询面（代号 toolwindow）

格式照 `docs/agent-playbook-parity.md` §「保留文件」。**目标文件全不在本批可改面，我一个字没自己动。**

## W-TW-1（给主代理 · `src/menuUi.ts` + `src/App.vue` 的属主）—— 把"当前窗口 id"喂给齿轮那道闸

- **目标文件**：`src/menuUi.ts:333` 与 `:336`（两条 `toolWindowGearLayout(...)` 调用）、`src/App.vue:2038` 与 `:2063`（两处 `:extra-rows="toolWindowGearRows"`）、`src/menuUi.ts:363`（那一份导出表）。
- **要接什么**：`src/menus/toolWindowGear.ts` 的 `toolWindowGearRows` 已经有第 5 参 `toolWindowId?: string`（不给 = 现行为完全不变，本批实测判据 `tests/tool-window-factories.test.mjs` 第 9 条）。要让它真的咬住，需要调用方把"这些内容挂在哪个工具窗口上"传进来：

  ```ts
  // src/menuUi.ts（紧接现有 :333 那一行加一条，:363 的导出表里把 toolWindowGearRowsFor 一并带出去）
  import { toolWindowGearRows as toolWindowGearLayout } from './menus/toolWindowGear.ts'
  // 侧栏齿轮：内容条本来就 `contentsScoped`，不给 id 与今天一模一样（留着只为对称）。
  const toolWindowGearRowsFor = (id: string) => toolWindowGearLayout(findMenuRow, undefined, false, gearHostRows(), id)
  // 底部 dock 的齿轮：只有当这一格里挂的是**注册过的工具窗口**（todo / vcslog / search / debug 这类
  // 停靠到底部的窗口）时才给 id；挂 references / hierarchy 这种"本仓没有注册记录的固定内容"时
  // **不要给**——门面那一位在无注册记录时答 null（= 沿用"有几条内容"的既有判据），传进去就会被当成
  // "该窗口的内容关不掉"而把 Close All 整行摘掉，那是把好用的行为关掉。
  const bottomGearRowsFor = (id: string | null) =>
    toolWindowGearLayout(findMenuRow, undefined, true, bottomGearHostRows(), id ?? undefined)
  ```

  ```html
  <!-- src/App.vue:2038 与 :2063（左/右侧栏那两处标题栏）-->
  :extra-rows="toolWindowGearRowsFor(leftView)"
  ```
- **为什么需要**：本仓的注册表已经带了 EP 的 `canCloseContents` 那一位（`src/toolWindowMeta.ts` 的 `toolCanCloseContents`，值逐条核过上游 XML），齿轮的这道闸（`requiresClosableContents`）也建好了，但**宿主没给 id ⇒ 这道闸在生产里一次都没被问**。判词 `ToolWindowImpl` / `ContentManagerImpl` 那两条要收到 `[x]`，缺的就是这一行。
- **上游依据**：`platform/platform-impl/src/com/intellij/ui/content/tabs/TabbedContentAction.java:87`/`:114`（`setEnabledAndVisible(myManager.canCloseContents() && …)`）、`platform/platform-impl/src/com/intellij/ui/content/impl/ContentManagerImpl.java:473`（`canCloseAllContents()` 第一句 `if (!canCloseContents())`）、`platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowImpl.kt:647`（值来自注册任务 `:264`）、`platform/platform-api/src/com/intellij/openapi/wm/ToolWindowEP.java:81-82`（属性本身）。
- **注**：`references` / `hierarchy` / `output` / `run` / `problems` / `terminal` 这些在本仓**没有** `<toolWindow>` 注册记录；上游对应窗口（Find / Hierarchy / Run / Problems / Terminal）的 `canCloseContents` 属性在本地参考树里逐条 find 过 —— Terminal 只有 `plugins/terminal/resources/META-INF/terminal.xml:4` 那一条 `anchor="bottom"`（没写该属性），其余几条指不到 ⇒ 请按"无法核实"处理，别让我或别人替它们编默认值。

## W-TW-2（给桶 8 弹层族的宿主属主）—— A1 剩下的两个分步列表宿主

- **目标文件**：`src/components/EditorPopupMenu.vue`、`src/components/SearchEverywhereDialog.vue`（这两个组件不在本批可改面；本批的清单里只有 `AnchoredMenu.vue` 等七个）。
- **核实结果（原写 X、实际 Y，留痕）**：桶 7b 的 A1 说「目标文件 `src/components/AnchoredMenu.vue`（第 12 行已经在 `import { usePopupAnchor }`，**列表渲染在它自己的 `v-for` 里**）」—— 打开文件核实：该组件全文 27 行，模板只有 `<div ref="box" class="tree-menu" :style="style"><slot /></div>`，**没有任何 `v-for`**，列表在宿主手里。同一条请求又说 `src/popupSteps.ts`「除自己的测试外全仓无人引用」，实际 `src/popupAnchor.ts:11` 早在值 import `showOptionsPoint`。
- **要接什么**：A1 点名而确实没人用的那一半（`listStepRows` / `shouldBeShowing` / `isClosableOnExecute` / `listSeparator`）本批已经接到 `src/components/ContentComboLabel.vue`（`SelectContentStep` 那一条上游链，判据 `tests/tool-window-factories.test.mjs` 第 11 条 = A1 要求的"生产消费点存在"门禁）。剩下两个宿主若要接，照 `ContentComboLabel.vue:106-113` 的形状办：`step` 给 `values/text/defaultOptionIndex`，行模型用 `listStepRows(step, { query, idOf })`，Enter 走 `row.closesOnExecute`，分隔行用 `separatorAbove` 返回 `listSeparator(text)`。
- **上游依据**：`platform/ide-core/src/com/intellij/openapi/ui/popup/ListPopupStep.java:38`（`isClosableOnExecute`，注释原文 "false if the menu item only opens a submenu or toggles a setting, leaving the popup open"）、`platform/ide-core/src/com/intellij/openapi/ui/popup/ListSeparator.java:22-44`、`platform/platform-impl/src/com/intellij/ui/popup/WizardPopup.java:561-570`（`shouldBeShowing` 的 `canBeHidden`/`getIndexedString` 两判）、`platform/platform-impl/src/com/intellij/ui/popup/list/ListPopupModel.java:44-48`（原索引映射）—— 逐条已在 `src/popupSteps.ts:43-149` 的注释里钉着行号，本批复核过。

## W-TW-3（给主代理 · 判词与门禁治理，三条）

1. **`docs/inventory/verdict-toolwindow-openapi.md` §G 建议改判 8 行**（我无权改那份文件）：
   - `ToolWindowManager`（第 336 行，现 `[-]`）→ `[]` 里那句"再抽一个只转发的门面没有新语义"自 2026-10-05 起已失效（`src/toolWindowManager.ts` 是真门面、有生产消费方，本批又加了 `canCloseContents`）；建议按 `[~]` 落点行改写，缺项写 `lastActiveToolWindowId`（`ToolWindowManager.kt:132`）。
   - `ToolWindowEP`（第 307 行 `[-]`）→ 建议 `[~]`：属性面已建为 `src/toolWindowFactories.ts:36-63` 的 `ToolWindowBean`，缺的是 XML 解析层（本仓无插件运行时，如实写明）。
   - `ToolWindowFactory`（第 329 行 `[~]`）→ 落点行加 `src/toolWindowFactories.ts`（`isApplicableAsync` 与 `shouldBeAvailable` 两道闸已分），仍缺 `createToolWindowContent` 数据化。
   - `WindowInfo`（第 253 行）/ `WindowInfoImpl`（第 349 行）→ 把"缺 `isSplit`"改为已落（EP `secondary` → `sideTool` → `DesktopLayout.kt:46`），仍缺 `weight`/`sideWeight`。
   - `ToolWindowManagerEx`（第 244 行）/ `ToolWindowManagerImpl`（第 245 行）→ 落点行补 `src/toolWindowManager.ts`，缺项保持 `clearSideStack` / `layoutToRestoreLater` / `DesktopLayout` 权重模型。
   - `ToolWindowImpl`（第 241 行）→ 加 `canCloseContents` 已接到查询面，缺宿主调用点（= W-TW-1）。
2. **`node --test tests/source-citation-anchors.test.mjs` 本批中途红过 1 条**（本批收工时**已由属主清掉、双门复绿**，此条只作留痕）：
   `moved :: src/fileTypeDetection.ts → platform/ide-core/src/com/intellij/openapi/fileTypes/NativeFileType.java|48-51`（快照里有、仓里已指不到）。`src/fileTypeDetection.ts` 本批一行没碰，是文件类型域在途改动 ⇒ 若它再红，请派给属主重算快照或改回正确区间。
3. **`docs/inventory/verdict-toolwindow-openapi.md` 的 §「四档计数自洽 = 350」** 若因上面改判而动，请一并重算，别让 `tests/*verdict*` 的计数判据抓红。

## W-TW-4（给主代理 · 需要宿主记账的一条查询面）—— `lastActiveToolWindowId`

- **目标文件**：`src/App.vue` 的工具窗口激活链（`showView` / `setToolAnchor` / 侧栏与底部的 `activeView`·`bottomTab` 写入点）与 `src/activeToolWindow.ts`（两处都不在本批可改面）。
- **要接什么**：`ToolWindowManagerSource`（`src/toolWindowManager.ts:96-127`）加一位 `lastActiveId: () => string | null`，门面的 `activeToolWindowId()` 旁边给出 `lastActiveToolWindowId()`；上游那一位读的就是"上一次激活的窗口 id"（`ToolWindowManager.kt:129-132`），配合 `HideActiveWindow`/`ToggleLastToolWindow` 那类动作。本仓 `src/toolWindowActions.ts` 的 `ToolWindowActionsContext` 里**已经有** `lastActiveId`（`:31`），只是它接的是编辑器标签的历史，不是工具窗口的 ⇒ 请宿主确认这两者是不是同一份账，别做成两份。
- **上游依据**：`platform/platform-api/src/com/intellij/openapi/wm/ToolWindowManager.kt:127`（`activeToolWindowId`）与 `:129-132`（`lastActiveToolWindowId`，注释原文 "ID of tool window activated last time"）。
- **为什么不在本批自己做**：门面自己记账 = 与宿主那份激活历史两份真相；而本批可改面里没有那两处写入点。

## 本批**不请求**的（免得白等）

- W-B11c-2（`src/components/ToolWindowView.vue` 的陈旧 `TestRunnerPanel` import）：**磁盘上已经不存在**（该文件里没有这条 import，`node .tools/find-orphan-modules.mjs --dead-imports` 也不报它）⇒ 桶 11c 那条请求可以关掉。
- 桶 10b 那份「接线请求（给桶 8）」的 6 条：逐条核过目标文件 —— `src/App.vue:2648`（Run Anything 的 cwd）、`SettingsDialog.vue`/`settingsModel.ts`（终端字号两格、ANSI 逐色号）、`CodeEditor.vue`+`editorCommands.ts`（大文件动作替换）、`SearchPanel.vue`/`EditorFindBar.vue`（正则提示）、`bridge.ts`（`elevate?`）—— **全部不在本批可改面**（`App.vue`/`CodeEditor.vue`/`settingsModel.ts`/`bridge*`/`SearchPanel.vue` 都是保留或他人在途），本批一条都没动，请主代理按原派单归属另派。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W-TW-1（把当前窗口 id 喂给齿轮闸）** —— 目标 `src/menuUi.ts`（非本 lane）+ `src/App.vue:2038/:2063`（本 lane）。复核 tw3 R-1 已走组件侧同一条判据（`ToolWindowGear :tool-window-id`），故本请求的组件侧已闭环；行表侧（`menuUi.ts`）需 owner 决定。
- **W-TW-2（分步列表宿主）** —— `src/components/AnchoredMenu.vue` 等（本 lane 可改面），登记。

结论：W-TW-1 已由 tw3 R-1 覆盖；W-TW-2 登记。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「W-TW-1 已由 tw3 R-1 覆盖；W-TW-2 登记。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
