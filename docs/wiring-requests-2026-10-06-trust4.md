# 接线请求 · 2026-10-06 · trust4（R4 本轮已落；剩下 3 条要接线 + 2 条要拍板）

> 范围说明：本轮按 `docs/wiring-requests-2026-10-06-welcome2.md` 落 **R4**（会话级信任两份并成一份），
> 并对 **R6 / R7** 只做判定与取证、不改代码。R2 / R3 的宿主那一半仍在 `src/App.vue`（保留文件）里，
> 本轮**没有**动它，只重数了行号。所有上游坐标都是 2026-10-06 trust4 轮在基准树里亲手打开核对过的：
> `D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
>
> 留痕（原写 X、实际 Y）：派单/上一轮给的 `platform/platform-impl/src/com/intellij/openapi/project/impl/TrustedProjects.kt`
> 与同目录的 `TrustedPaths.kt`、`ProjectUtil.kt` **都不存在**（`ProjectUtil.kt` 也不在那个包下）。
> 实际路径是 `platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjects.kt`、
> `platform/platform-impl/src/com/intellij/ide/impl/TrustedPaths.kt`、
> `platform/platform-impl/src/com/intellij/ide/impl/ProjectUtil.kt`（后者只有两行与 trust 有关：
> 引 `TrustedFiles`、`markExternallyOpened`，与本轮判据无关）。下面一律写实际路径。

## R4 · 已落：会话级信任并成一份（不需要再接线，登记核对结果）

- 合并前的两份（实测）：
  - 宿主那份：`src/workspaceLifecycle.ts` 原 `:91` 自留 `const sessionTrust = ref<TrustedPathEntry[]>([])`，
    唯一读点原 `:93`（`trustEntries()` 的并集）、唯一写点原 `:128`（`confirmTrust` 没勾「以后不再询问」那一路）；**不落盘**，随应用退出消失。
  - 模块那份：`src/trustedProjects.ts` 的 `sessionTrustedLocations` 数组（现 `:343`），
    读写口 `sessionTrustEntries()` / `rememberSessionTrust()` / `replaceSessionTrust()`（现 `:346` / `:355` / `:364`），
    消费方是设置页 `src/components/TrustedLocationsSettingsPage.vue:27-28`、`:71-72`、`:63`；同样**不落盘**。
- 合并后（真源 = 模块那份）：`src/workspaceLifecycle.ts:100-101` 读 `sessionTrustEntries()`，
  `src/workspaceLifecycle.ts:136` 写 `rememberSessionTrust(root, choice === 'trust')`；
  宿主的 `ref` 已删，全仓再无第二份（`grep -rn "sessionTrust\b" src/` 只剩注释里那句「原先」的历史说明）。
- 判据：`tests/trusted-session-single-source.test.mjs`（7 条，含「旧位置写入 → 新真源读得到」与迁移等价性）；
  `tests/welcome-trust-dialog.test.mjs` 最后一条原先钉的是**未接线形状**（`assert.match(lifecycle, /const sessionTrust = ref…/)`），
  按上一轮文件头的约定（「落地时要反转的判据」）改成正向钉，App.vue 那两句未落所以原样保留。
- 上游依据（两张表合一 / 一份存储）：
  `platform/platform-impl/src/com/intellij/ide/impl/TrustedHostsConfigurable.kt:66-71`（`getMergedTrustedPaths()`：
  用户手管的 `TrustedPathsSettings` + 确认框答应过的 `TrustedPaths`，注释 `:60-64` 原文 "One list over both trust stores"）、
  `:80-89`（`applyMergedTrustedPaths`：按差集**各回各家**）；
  两侧读写的是同一个单例 `platform/platform-impl/src/com/intellij/ide/impl/TrustedPaths.kt:25-28`，
  确认框那一路写它经 `platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjectsDialog.kt:64-74`。
  本仓「两个存储」= 持久 `generalSettings.trustedPaths` + 会话这一份，形状仍是 `{path, trusted}`。

## T1 · `workspaceLifecycle` 的 return 表要露两个名字（welcome2 R2/R3 的前置，我没有消费方所以不加）

- **为什么本轮不加**：`trustEntries` / `saveTrustedPaths` 现在在模块内已有真实消费者，但对外露出去就是
  「零消费方的导出」（规约 §3：不接就不留）。它们唯一的消费者是 `src/App.vue` 的 R2 那三条 URL 出口。
- **目标文件 / 行号**：`src/workspaceLifecycle.ts:439`
- **可照抄的整段替换**：

```ts
    trustPrompt, resolveTrustPrompt, projectTrustBlock, trustEntries, saveTrustedPaths,
```

- 配套（R3 那半在本轮之后仍然只差三处）：`src/App.vue:2646` 那一行补 `:can-trust-all="true" :config-dir="appConfigDir"`；
  `src/workspaceLifecycle.ts:136` 所在的 `confirmTrust` 把回值收成三个、落库换成 `trustDecisionPaths` + `applyTrustDecision`
  （逐行等价物与判据已在 `src/trustedProjects.ts:270-296` / `tests/trusted-trust-all.test.mjs`）。
  **不给 `config-dir` 就别给 `can-trust-all`**：`platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjects.kt:103-107`
  （配置目录里的项目不给这一项）+ `platform/platform-impl/src/com/intellij/ide/trustedProjects/impl/TrustedProjectsStartupDialog.kt:85-92`
  （勾选框 = `projectPath.parent?.takeIf { isProjectLocationOfferedForTrust }`）。

## T2 · `src/semanticActions.ts:187` 只读持久清单，看不见会话那一份

- 现状：`const blockedByTrust = trustBlockReason('格式化', workspace()?.root, generalSettings.value.trustedPaths)`
  —— 传进去的是**持久那一份**，没有并会话档；于是「这次信任」之后仍然不能格式化。
  这与执行侧门禁（`src/workspaceLifecycle.ts:100-101` 的并集）口径不一致，是 R4 那份「并集」的第四个读点。
- **要动的两行**（不在保留文件里，但属 formatting 域在途文件，本轮没碰，避免踩别人现场）：
  - import：`src/semanticActions.ts` 里把 `trustBlockReason` 那份 import 补上 `mergeTrustEntries, sessionTrustEntries`
  - 调用：`trustBlockReason('格式化', workspace()?.root, mergeTrustEntries(generalSettings.value.trustedPaths, sessionTrustEntries()))`
- 上游口径：判据只有一个 `TrustedProjects.isProjectTrusted(project)`
  （`platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjects.kt:56-73`），
  它读的是**两个存储合并后**的状态，不存在「某一处入口只读持久清单」这种分叉。
- **判据**：落地时把 `tests/formatting-restriction.test.mjs`（或同族用例）里那条「未信任不给格式化」补一条
  「会话档答过信任 ⇒ 放行」。

## T3 · 「这次信任」根本进不了宿主硬边界（要么按上游一律落库，要么把会话档递给 native）

- 事实链（本轮实测）：会话级那一份**只在前端**；宿主的三道硬边界读的是持久清单
  —— `native/main.cpp:357`（调试）、`native/main.cpp:1107`（构建 / 运行）、`native/main.cpp:1365`（打开终端）
  全部把 `general_settings()` 交给 `taocode::trusted::require_trusted`（`native/trusted_paths.cpp:55-63`）。
  所以答「这次信任」（没勾「以后不再询问」）后：前端门禁放行 ⇒ 宿主仍然回 `UNTRUSTED_PROJECT`。
  **这条口径差在我合并前后都存在**（合并只是把前端的两份收成一份），但正因为收成了真源一份，现在才看得见该在哪收口。
- 上游没有「只活本次会话」这一档：确认框答完就写 `TrustedPaths`（持久存储 `trusted-paths.xml`，
  `platform/platform-impl/src/com/intellij/ide/impl/TrustedPaths.kt:19-22`、写入体 `:60-66`），
  而且上游那颗框**没有**「以后不再询问」—— 只有 trust-all 那颗（`TrustedProjectsDialog.kt:64-71`）。
- **要主代拍板的那一句**：会话档要不要照上游改成「答了就落 `generalSettings.trustedPaths`（勾 trust-all 再多落父目录）」？
  拍 (a) 照上游 ⇒ 删掉会话这一档、`confirmTrust` 一律 `saveTrustedPaths(applyTrustDecision(...))`，设置页那张表就此只剩一个存储；
  拍 (b) 保留会话档 ⇒ 宿主边界必须看得见它（给 `require_trusted` 传合并后的清单，等于 native 要拿到前端会话态，
  要么加一条 `trust.session.sync` 之类的方法，成本比 (a) 高）；本轮按 (a) 的判据准备好、按 (b) 的判据也备得起来，**不动实现**。

## R6 · 左栏「收藏」那一栏：上游**没有**（维持不渲染，等主代拍「删掉」）

- 本轮自己走的三条路（不是转述 welcome2）：
  1. **按功能名搜包**：`platform/platform-impl/src/com/intellij/openapi/fileChooser/` 全包（含 `universal/`、`ex/`）
     对 `favorite` 做**大小写不敏感** grep ⇒ **0 命中**；`UniversalFileChooser.kt` 里 `avorite` 也是 0 命中。
  2. **按左栏真实实现看**：`platform/platform-impl/src/com/intellij/openapi/fileChooser/universal/UniversalFileChooser.kt:304-305`
     的 splitter 左件是 `createLocationsPanel(project)`，同文件 `:677-696` 逐项列出的只有
     **Home（`AllIcons.Nodes.HomeFolder`）/ Desktop（`AllIcons.Nodes.Desktop`）/ Project（`AllIcons.Nodes.Project`，且 `!project.isDefault`）** 三项，
     `locationList.selectionMode = SINGLE_SELECTION`（`:698`）—— 没有「收藏」这一组，也没有多根。
  3. **按 XML / 别处的同名功能搜**：`FavoriteList` 之类的 action id 在 `platform/platform-impl/resources/*.xml` 里 0 命中；
     收藏视图在完全另一个模块 `platform/favoritesTreeView/src/com/intellij/ide/favoritesTreeView/FavoritesManager.java`（Project 视图的 Favorites），
     与文件选择器没有任何引用关系（那个包里 grep 不到 fileChooser，反之亦然）。
     ⇒ 14c 请求 1 里那句「把收藏栏接到真数据上」的**上游依据不成立**；本仓这一栏是早先编出来的。
- 现状不是假控件：宿主传的是空数组（`src/App.vue:1446` 的 `favorites: () => []`、`src/App.vue:2388` 的 `:favorites="chooser.favorites()"`），
  渲染处 `src/components/FileChooserDialog.vue:309` 是 `v-if="shortcuts.favorites.length"` ⇒ 一行都不出现。
- **要主代拍板的那一句**：**整栏删掉**（welcome2 与本桶同意见）—— 组件/模型/宿主状态三处都在名下，
  只差 `src/App.vue:1446` 的 `favorites: () => []` 那一条 dep 与 `src/App.vue:2388` 的 `:favorites=` 绑定（T4：一次请求就能清干净），
  并连带删 `src/fileChooserModel.ts` 的 `favoriteShortcuts`（`:340`，注释 `:333-336` 已如实登记「上游无此类」）；
  拍 (b) 换成上游那三个固定位置则要先回答「Home/Desktop 在工作区外、`workspace.list` 列不出来」怎么办，本桶认为语义会变味，不建议。

## R7 · 多选：维持 `[-]` 不做（触发条件写死，两条都要满足才动）

- 本轮复核（生产调用点）：`chooseMultiple === true` 的那三颗描述件（`src/fileChooserDescriptor.ts:92-103`）
  **没有任何生产调用点** —— 全仓 grep `multiFilesDescriptor` / `multiDirsDescriptor` / `multiFilesOrDirsDescriptor` 只命中定义文件本身
  与钉它形状的 `tests/file-chooser-descriptor.test.mjs`；生产侧走的全是单选：
  `pickDirectory`（`src/workspaceLifecycle.ts:379`）、插件包/目录（`src/projectExtras.ts:30-31`、`:65`）、JDK/输出目录（`src/settingsPersistence.ts`、
  `src/components/ProblemsPanel.vue:536`）、受信任位置浏览（`src/components/TrustedLocationsSettingsPage.vue:43`）。
  唯一「看起来会走到多选」的那一处是 `src/fileChooserDescriptor.ts:122` 的
  `createAllButJarContentsDescriptor(multiple = true)`（`:123` 内部拿 `multiFilesOrDirsDescriptor()`），
  但这个工厂函数本身在 `src/` 里**一个调用方都没有**（grep 只命中定义行）⇒ 多选链路线上不可达，不是被绕过的真功能。
- **第二个硬条件（本轮新证，比 welcome2 的口径更具体）**：宿主通道本身就没有多选 ——
  `native/dialogs.cpp:153-166` 的 `pick_file` 用 `IFileOpenDialog` + `GetResult(&item)` 取**单个** `IShellItem`，
  没有 `FOS_ALLOWMULTISELECT`（native 全目录 grep `ALLOWMULTISELECT` 0 命中）；
  `src/bridge.ts:109` 的 `Method` union 里也没有 `dialog.pickFiles`。
  ⇒ 光改前端拿不到多份结果，行上做 Ctrl/Shift 多选 = 假控件，按规约 §3 不渲染。
- 上游确实有多选（记着，等真要做时照这两行）：
  `platform/platform-impl/src/com/intellij/openapi/fileChooser/ex/FileChooserDialogImpl.java:452`（`getSelectedFiles()` 返回数组）、
  `:552`（`VIRTUAL_FILE_ARRAY` 数据口）。
- **触发条件（写死）**：① 出现第一个真实多选调用点（候选就是盘上那颗还没人调的
  `createAllButJarContentsDescriptor(multiple = true)`，`src/fileChooserDescriptor.ts:122`，用于「把选中的若干 jar 加进
  `referencedLibraries`」—— 现在那条走 `src/settingsPersistence.ts` 的单选循环）；② 且宿主那条 `dialog.pickFiles`（`FOS_ALLOWMULTISELECT` + 返回数组）
  已在 `Method` union 与 `native/dialogs.cpp` 到位。两条同时满足才动 `src/fileChooserHostState.ts` 的
  `chooseMany()` 与 `src/components/FileChooserDialog.vue` 的选区（裸点清空 / Shift 段选 / Ctrl toggle，口径抄 `src/welcomeRowSelection.ts`）。
- **要主代拍板的那一句**：要不要为 ① 那个「多选 jar」的真调用点立项？立了就同一批把 ②（native + `CMakeLists.txt` 都不在名下，得走请求）一起接；
  不立则本桶维持 `[-]`，不动代码。
