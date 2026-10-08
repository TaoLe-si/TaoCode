# batch-2026-10-06-runcfg4 — 运行配置 UI 族剩余项（先核后做）

范围：`docs/inventory/` execution / run-configurations 族判词 ↔ 磁盘实现 三档表；只实现**不动保留文件、用户可见**的 1–2 项。
上游参考树（唯一可用）：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`

约定：所有上游坐标自行开树核实；假坐标写「订正留痕」；中文措辞无法核实登记「无法核实」；判据前缀 `RUNCFG4-PROBE`。

## 0. 口径（主代理已定，不推翻）

- JAR 运行配置已落：`src/jarRun.ts`、`native/settings_schema.cpp:1011-1012`（白名单含 `jar`）、`src/runActions.ts` jar 分支。
- 真正缺的是 `RemoteRunProfile` 那一族。
- `Runner.FocusOnStartup` 单一真源已收（旧 global storage 已删）。
- `RunStartParams.elevate` 需 daemon/trampoline 层，独立批次，本批**不做**。

### 派单里几处坐标的订正留痕（原写 X、实际 Y）

| 原写 | 实际 | 证据 |
|---|---|---|
| ~~`native/settings_schema.cpp:1011-1012` 白名单含 `jar` 需要订正~~ | **不需要订正，派单这条成立**：实测 `:1009-1013` 是类型白名单那一段，`:1011` 就是 `type != "shell" && … && type != "jar"`、`:1012` 是那句报错 ⇒ 本批第一次核的时候只看到 `:984` 起的整段、把区间写宽了，**这句过头话原地收回** | `native/settings_schema.cpp:1009-1013`（只读引用） |
| `src/bridge.ts` 1 行 | **实际 904 行**（`src/bridge.ts` 里 `:10` 就 import `normalizeRunConfigurations`、`:215` 那条预览校验在 `src/bridgePreview.ts`）；仍是保留文件 ⇒ 本批一律只读，只把「1 行」这个说法订正掉 | `wc -l src/bridge.ts` = 904 |
| 「上游有 zh 本地化包，`ExecutionBundle.properties:19/:20` 的 zh 文案」 | **本地树里没有任何中文包**：`find -name "*_zh*.properties"` 全树 0 命中；`platform/execution/resources/messages/` 下只有 `ExecutionBundle.properties` 一个文件。`:19`/`:20` 实际是英文原文 `nothing.to.run.error.message=There is nothing to run` / `no.suitable.targets.to.run.error.message=No suitable targets to run on; please choose a target for each configuration` ⇒ 仓内 `src/runConfigEditors.ts` 头部两处「zh 文案」的说法是假坐标，本批原地改成「英文原文直译」口径 | 见 §2 第 11 条 |
| 候选项里的「Before Launch 任务列表的顺序（可重排）」 | **上游没有重排**：`platform/execution-impl/src/com/intellij/execution/impl/BeforeRunStepsPanel.java` 只给 `ToolbarDecorator` 设了 edit(:104)/add(:135)/remove(:152) 三个动作，`addTask` 是 `myModel.add(task)`（`:327-330`，追加到末尾）；全文件 grep 无 `setMoveActionUp`/`setMoveActionDown` ⇒ 造「上移/下移」就是假控件 | §2 第 7 条 |

## 1. 磁盘现状（自查，非照抄）

| 磁盘文件 | 行数 | 已经承载的运行配置 UI 行为 |
|---|---:|---|
| `src/runConfigTree.ts` | 193 | 类型→文件夹→配置三层树（`buildRunConfigTree`）、唯一名（`uniqueRunConfigName`）、复合闭包/环校验（`runConfigClosure`）、文件夹名校验（`validateFolderName`）、参数串可逆（`formatRunArguments`/`parseRunArguments`） |
| `src/runConfigurations.ts` | 242 | 草稿状态机（`load`/`currentRunConfig`/`runConfigDraft`）、临时配置会话表、落盘 `persistRunConfigs`/`saveRunConfigFromDialog`/`removeRunConfigFromDialog`、Before launch 步骤增删（`addBeforeLaunchStep`/`removeBeforeLaunchStep`） |
| `src/runConfigurationSchema.ts` | 139 | 落盘门：字段白名单、类型清单三层（家族/pending/已接）、名字唯一、复合成员存在性 |
| `src/runConfigEditors.ts` | 256 | 逐类型字段表 `RUN_CONFIG_EDITORS` + 逐类型校验 `checkRunConfiguration` |
| `src/runConfigTemplates.ts` | 150 | 类型模板（localStorage、按项目根分键） |
| `src/runInstances.ts` | 869 | 运行实例行模型（标签条/正在运行清单/停止判定） |
| `src/components/RunConfigurationsDialog.vue` | 667 | 对话框本体：左树 + 工具条（添加/删除/复制/保存/新建文件夹）+ 右栏模板页与配置页 + Before launch 折叠块 + 操作系统组 |
| `src/runActions.ts`（保留，只读） | — | jar 分支与 `startRun` 消费那两个聚焦开关 |

结论：配置族的**骨架已在**；缺口集中在「副本/重命名的上游规则」「Store as project file 的三档语义」「Remote 那一族」三处。

## 2. 上游核对（逐条自己开树，全部给相对路径:行号）

1. `platform/execution/resources/messages/ExecutionBundle.properties:286` = `run.configuration.store.as.project.file=&Store as project file`（这一条**确实存在**，不是编的）。
2. `platform/execution-impl/src/com/intellij/execution/impl/RunConfigurationStorageUi.java`（531 行，全类实读）：
   - `:107` 复选框、`:108/:130-142` 齿轮按钮（`run.configuration.manage.file.location`）。
   - `:530` `private enum RCStorageType {Workspace, DotIdeaFolder, ArbitraryFileInProject}` ⇒ **「Store as project file」不是一档而是三档**：勾上 = 后两档，不勾 = `Workspace`（本地工作区，不是项目文件）。
   - `:281-346` `setStorageTypeAndPathToTheBestPossibleState()`（UX-1126 流程图）：已共享过 ⇒ 保持原档；IPR 工程 ⇒ `.idea`；工程不在 VCS 下 ⇒ `.idea/runConfigurations`；`.idea/runConfigurations` 未被 VCS 忽略 ⇒ 同上；baseDir 不在 content ⇒ 同上；别处只有一档 ⇒ 那个目录；默认 `<base>/.run`（`:344-345`）。
   - `:391` `isManagedRunConfiguration = settings.getConfiguration().getType().isManaged()` → `:403/:406` **复选框与齿轮只对 managed 配置启用/可见**；`:393-397` reset 按 `isStoredInArbitraryFileInProject / isStoredInDotIdeaFolder / 其余 Workspace` 三档还原。
   - `:415-432` apply：`storeInLocalWorkspace()` / `storeInDotIdeaFolder()` / `storeInArbitraryFileInProject(folder + "/" + fileName)`，文件名 = `MODERN_NAME_CONVERTER(name) + ".run.xml"`（`:227-229`），模板名前置 `Template <type display name>`（`:425`）。
   - `:232-269` 路径校验六条（`.idea` 里禁、必须目录、必须在工程内、不能在 excluded root…），文案 `ExecutionBundle.properties:287-293`。
3. `platform/execution/src/com/intellij/execution/RunnerAndConfigurationSettings.java:55 isTemporary()`、`:141 setTemporary(boolean)`；`platform/execution-impl/src/com/intellij/execution/impl/RunManagerImpl.kt:1223 temporarySettings` 只出临时的、`:1226 settings.isTemporary = false`（makeStable）。
4. `platform/execution-impl/src/com/intellij/execution/impl/RunConfigurable.kt`（1599 行）：
   - `:989 MyRemoveAction`、`:1129 MyCopyAction`、`:1173 MySaveAction`、`:1229 MyCreateFolderAction`、`:1289 MySortFolderAction`。
   - 副本名：`:1142 createUniqueName(typeNode, configuration.nameText, CONFIGURATION, TEMPORARY_CONFIGURATION)` ⇒ **base = 源配置自己的名字**，上游没有「副本/Copy of」这种后缀；`:1143 setNameChangedByUser(true)`。
   - 副本落点：`:1151 createNewConfiguration(settings, node, selectedNode)` → `:902 treeModel.insertNodeInto(nodeToAdd, node, node.getIndex(selectedNode) + 1)` ⇒ **紧跟在源后面**，不是排到列表尾。
   - 副本可用性：`:1161-1163 e.presentation.isEnabled = configuration != null && configuration.configuration.type.isManaged`。
   - 新建名：`:934 createUniqueName(typeNode, suggestName(configuration), …)`，`:942-949 suggestName` 只取 `LocatableConfiguration.suggestedName()`，取不到 ⇒ `createUniqueName` 回落 `run.configuration.unnamed.name.prefix`（`ExecutionBundle.properties:266` = `Unnamed`，见 `:1559`）。
   - 唯一名作用域：`:1548-1575 createUniqueName` 只在**该类型子树**（含文件夹）里数名字。
   - 重名拦截：`:659-666` apply 时 `names.add(nameText)` 失败 ⇒ 选中那节并抛 `dialog.message.run.configuration.already.exists`（bundle `:66` = `{0} with name ''{1}'' already exists`，`{0}` = 类型显示名）。
   - 文件夹：`:673-686` 空名抛 `dialog.message.folder.name.should.not.be.empty`（bundle `:67`）、同类型内重名抛 `dialog.message.folders.have.same.name`（bundle `:68`）；`:1237` 新文件夹 base = bundle `new.folder`（`:730` = `New Folder`）；`:1258-1288 update()` 跨类型选择 ⇒ 禁用，选中里有配置 ⇒ 文案换成 `run.configuration.create.folder.description.move`。
   - `:1289 MySortFolderAction`（工具条「Sort Configurations」，bundle `:79`；描述 `:80` = `Sort configurations alphabetically`）：`:1292-1307` 比较器 = **文件夹在前（保持原相对次序）→ 普通配置按名 → 临时配置在后（按名）**；`:1309-1330 actionPerformed` 逐个选中的类型/文件夹节点重排其直接子节点；`:1331-1341 update()` = 只有选中 CONFIGURATION_TYPE 或 FOLDER 节点才启用。
   - `MyCreateFolderAction` 的可用性档在 `:1258-1288`（`:1284` 是 `e.presentation.isEnabled = isEnabled` 那一行）。
   - 节点种类 `:170-183`（`RunConfigurableNodeKind`）与 splitter `:520-586` 两段确在文件里（本仓既有注释引的这两处行号成立）。
5. `platform/execution/src/com/intellij/execution/RunManager.kt:51-65 suggestUniqueName`：没被占用 ⇒ 原样；否则 `extractBaseName`（`:67-71` 正则 `(.*?)\s*\(\d+\)`，剥掉尾部的 ` (N)`）+ `String.format("%s (%d)", base, i)`，**i 从 1 起**；`:203-206` 可按类型作用域；`:215-219 setUniqueNameIfNeeded`。
6. `platform/execution/src/com/intellij/execution/configurations/ConfigurationType.java:79-85 isManaged()` 默认 `true`；全树唯一返回 `false` 的实现是 `platform/execution/src/com/intellij/execution/configurations/UnknownConfigurationType.java:42`。配套：`platform/execution-impl/src/com/intellij/execution/impl/SingleConfigurationConfigurable.java:111 myBrokenConfiguration = !configuration.getType().isManaged()`、`:698/:706` 允许并行复选框同理。
7. `platform/execution-impl/src/com/intellij/execution/impl/BeforeRunStepsPanel.java`（393 行）：
   - `:82` 空表文案 `before.launch.panel.empty`（bundle `:303`）、`:83` 单选、`:85` 可见 4 行。
   - `:127-134` **edit 按钮只在 `provider.isConfigurable()` 时可点**；`:144-150` add 按钮 = `checkBeforeRunTasksAbility(true)`；`:152-163` remove = 多选删除（`ListUtil.removeSelectedItems`）。
   - `:166-171` 底部三格：`configuration.edit.before.run`（bundle `:346` = `Show this page`）、`configuration.activate.toolwindow.before.run`（`:347`）、`configuration.focus.toolwindow.before.run`（`:348`）；`:209-217` reset 时三格 `setEnabled(!isUnknown())`。
   - `:204-220 doReset` + `:218 myPanel.setVisible(checkBeforeRunTasksAbility(false))` ⇒ **没有任何可加的任务时整条工具条不可见**。
   - `:222-227 updateText()`：`count == 0 || isVisible() ? "" : message("before.launch.panel.title.suffix", count)` ⇒ **条数后缀只在折叠且非空时挂在标题上**（bundle `:301` `&Before launch`、`:302` `: {0,choice,1#1 task|2#{0} tasks}`）。
   - `:247-264 checkBeforeRunTasksAbility`：`isUnknown()` ⇒ false；否则要求存在 provider 且 `createTask != null`，只看 add 时还要「非 singleton，或该 singleton 尚未在列表里」。
   - `:269-303 doAddAction`：跳过 `createTask==null` 与「已在场的 singleton」（`:275-277`）；`:288-292 canExecuteTask` 不通过就不加；`:294-302` 任务指回自己 ⇒ `before.launch.panel.cyclic_dependency_warning`（bundle `:304`）。
   - `:327-330 addTask` 追加末尾；`:364-382` renderer 文案 = `provider.getDescription(task)`，provider 已消失时用 `UnknownBeforeRunTaskProvider`（bundle `:308` = `Unknown Task`）。
   - `:266-268 isUnknown()` = `myRunConfiguration instanceof UnknownRunConfiguration`。
8. `platform/execution-impl/src/com/intellij/execution/impl/ConfigurationSettingsEditorWrapper.java`：`:49-59` 只有**模板**配置才建 `RunConfigurationStorageUi` + `RunOnTargetPanel`；`:71-74` `beforeRunStepsRow.visible(!(settings.getConfiguration() instanceof WithoutOwnBeforeRunSteps))` + 「允许并行」只挂模板；`:136-146 doApply` 把三格写回 `settingsToApply.setEditBeforeRun/ setActivateToolWindowBeforeRun/ setFocusToolWindowBeforeRun`。
9. `platform/execution-impl/src/com/intellij/execution/compound/CompoundRunConfiguration.kt:91-101`：成员按 `(type, name)` 解析，`findConfigurationByTypeAndName` 返回 null 就 `continue`；`:160` 存的是 `TypeNameTarget(type.id, name, targetId)`。⇒ **上游重命名不会回写成员引用**（解析不到就当没这条）。
10. `platform/execution-impl/src/com/intellij/execution/impl/EditConfigurationsDialog.java` 存在（`platform/execution-impl/src/com/intellij/execution/impl/`）；对话框标题文案 `ExecutionBundle.properties:87` = `run.debug.dialog.title=Run/Debug Configurations`；内建页签标题 `:58` = `run.configuration.configuration.tab.title=Configuration`。
11. **无中文包**：`find <树> -name "*_zh*.properties"` 0 命中，`platform/execution/resources/` 只有 `messages/ExecutionBundle.properties` 与 `intellij.platform.execution.xml` ⇒ 本批所有中文措辞都是「英文原文直译」，逐条在注释里注明，不当真原文。
12. 本仓设计侧证据（为什么 Store as project file 不能直接做）：`native/projects_test.cpp:281 check(fs::is_empty(project), "Configuration may not be stored in the user project")`、`native/projects_test.cpp:443` 同族断言、`native/settings_schema.cpp:980-982` 注释写明「配置随项目走，落法与 IDEA 的 `.idea/runConfigurations` 同义」。

## 3. 三档表（判词 ↔ 磁盘；只做运行配置 UI 面）

档：`做` = 磁盘已有等价可见行为；`半成品` = 有落点但规则/可见性与上游不符；`缺` = 无落点。

| 项 | 上游 | 档 | 磁盘落点 / 差在哪 |
|---|---|---|---|
| 左树三层（类型/文件夹/配置/临时） | `RunConfigurable.kt:170-183` | 做 | `src/runConfigTree.ts:97-120`、`RunConfigurationsDialog.vue:385-435` |
| 添加（按类型新建） | `RunConfigurable.kt:952-978` | 做 | 对话框 `:439-444` `addConfig` |
| 删除配置 | `:989` | 做 | 对话框 `:445` |
| 复制配置 · 名字 | `:1142` + `RunManager.kt:51-65` | **半成品 → 本批改** | `runConfigTree.ts:122-130` 用 `名 2/3`；`RunConfigurationsDialog.vue:325` 的 `名 副本` 是**自造后缀**（上游无） |
| 复制配置 · 落点 | `:902`（紧跟源） | **半成品 → 本批改** | `runConfigurations.ts:196-204` 新名字找不到 ⇒ 追加到表尾 |
| 复制配置 · `isManaged` 门 | `:1161-1163` | 缺，且**不补**（`[-]`） | `ConfigurationType.java:83-85` 默认 true，唯一 false 是 `UnknownConfigurationType.java:42`；本仓 schema 直接拒未知类型（`runConfigurationSchema.ts:88`）⇒ 没有 broken 配置这一档，补上就是假门 |
| 重命名（改名字段后保存） | 就地改名（`:659-666` 只管重名） | **缺 → 本批改** | 现状：`runConfigurations.ts:196-204` 只按**新名**去重 ⇒ 旧名那条留在盘上，变成「旧配置 + 新配置」两条 |
| 重名拦截 | `:663-666` + bundle `:66` | **缺 → 本批改** | 表单里没有这道判据；靠 schema `runConfigurationSchema.ts:115` 抛「运行配置名不能重复」把**整份写入**打回 |
| 同类型内文件夹重名/空名 | `:673-686` + bundle `:67/:68` | **半成品 → 本批改** | `runConfigTree.ts:108-109` 把同名文件夹**静默合并**成一个节点；`validateFolderName:183-188` 允许空名（空 = 不分组） |
| Sort Configurations（工具条） | `:1289-1341` + bundle `:79` | **缺**（判词表也没列，本批开树发现） | 要一次改整份数组顺序；对话框只有单条 `save` 事件 ⇒ 需 `persistRunConfigs` 的批量入口，见接线请求 |
| Store as project file（三档） | `RunConfigurationStorageUi.java:281-432` | **缺**（本批不做，理由已核） | 要往用户项目写 `.run/*.run.xml`，`native/projects_test.cpp:281/:443` 两条设计断言锁住；且要新增 native 模块 + `src/bridge.ts` 方法联合 + `native/main.cpp` 分派（三处保留）⇒ 独立工程，本批只做语义核对（§2 第 2 条）并登记 |
| Run on target（只挂模板） | wrapper `:49-59` | 做 | 对话框模板分支 `:466-477` + `src/executionTargets.ts` |
| Before launch：折叠标题带条数 | `BeforeRunStepsPanel.java:222-227` | **半成品 → 本批改** | `RunConfigurationsDialog.vue:553-557` 的「N 步」恒显示（上游：展开时不显示、0 条不显示） |
| Before launch：无可加任务时整条隐藏 | `:218` | 不适用 `[-]` | 上游按 provider EP 判定；本仓步骤是自解释的 `name\|command`，任何配置都能加步骤 ⇒ 门恒真，隐藏逻辑没有对应的假档 |
| Before launch：上移/下移 | 无（见 §0 订正留痕） | 不适用 `[-]` | 上游只追加（`:327-330`），本仓 `addBeforeLaunchStep` 也是追加 |
| Before launch：`Show this page`（`settings.isEditBeforeRun`） | `:166/:209`、wrapper `:143` | **缺** | 本仓没有这一格，且它是每条配置一个布尔 ⇒ 要新增持久化键 + `native/settings_schema.cpp` known_keys（保留文件）⇒ 接线请求 |
| 复合配置不显示「启动前」 | wrapper `:71-74` + `WithoutOwnBeforeRunSteps` | 做 | `runConfigEditors.ts:126` `withoutOwnBeforeRunSteps` + 对话框 `hasField('beforeLaunch')` |
| 复合成员引用 | `CompoundRunConfiguration.kt:91-101` | 半成品 | 本仓只按名字引用（`runConfigTree.ts:178-180`），改名后本仓 `normalizeRunConfigurations` 会把整份写入判坏 ⇒ 本批随重命名一并处理（差异登记在 §4） |
| `RemoteRunProfile` 一族 | `docs/inventory/execution_verdict_table.md:667`（`exec/run-configs`，25 行，判词 `[~]`）、`:84-88` `RemoteConfigurable`/`RemoteConfigurationType` 等 | **缺**（本批不做） | 判词的 TaoCode 列全为「从未出现」；落点要 daemon/传输层，与 `RunStartParams.elevate` 同属独立批次（口径 §0） |
| `RemoteProcessSupport`/`TerminateRemoteProcessDialog` | 同表 `:709` `[-]`、`:242` `[-]` | 不适用 `[-]` | Swing + 进程宿主两侧都没有对应物，本批不动 |

族级计数（判词簿原始数，不改动 `execution_verdict_table.md`，那是 `scripts/verdict_table.py` 生成物且为保留文件）：
`exec/run-configs` 94 行、`exec/ui` 99 行、`exec/run-toolbar` 71 行、`exec/target` 85 行；execution 全表 `[x]0 / [~]978 / [ ]0 / [-]630 / 合计 1608`。

## 4. 本批实现项（两项，都不动保留文件、都用户可见）

### 项 1：副本 / 重命名 / 新建的可用性与命名规则对齐上游

**先核后做之后的实际形状**（与最初打算的差别都在这一节里标出）：

1. `uniqueRunConfigName(configs, base)`（**两参，没有加 scope**：本仓名字全局唯一，加了就是没人用的参数）
   = 上游 `RunManager.kt:51-65`：未被占用 ⇒ 原样；被占用 ⇒ 先 `extractRunConfigBaseName`（`:67-71`）剥尾部 ` (N)`，
   再 `%s (%d)`、**N 从 1 起**。作用域差异在注释里登记（上游 `RunConfigurable.kt:1548-1575` 按类型子树数名字）。
2. 副本：基名 = 源名（订正掉自造的 ` 副本`），并插在源之后（`RunConfigurable.kt:902`）。
3. 重命名：对话框把「前身」作为 **第二个 emit 实参**带下去，形状是 `{ from, copyOf }`
   （`RunConfigSaveOrigin`，不是最初计划的裸字符串 —— 要同时表达「改名」与「副本」两种）；
   `saveRunConfigFromDialog(config, origin?)` 交给 `applyRunConfigSave` 算槽位 ⇒ **就地替换、位置不动**（上游 uniqueID 不变）。
   `src/App.vue:2563` 那句 `@save="saveRunConfigFromDialog"` 本来就会把两个实参都传进处理函数 ⇒ 保留文件不用动（判据把这句钉住了）。
4. 重名拦下：目标名被**另一条**占用 ⇒ 写盘前报 `dialog.message.run.configuration.already.exists` 的直译
   （`{0}` = 类型显示名、`{1}` = 名字）；判据排在逐类型校验**之后**，与上游 `applyByType` 的先后一致
   （先 `applyConfiguration` 再 `names.add`，`RunConfigurable.kt:649-666`）。
5. 引用回写（**本仓差异，已登记**）：改名时把复合成员里的旧名一起换新名。
   上游不回写（`CompoundRunConfiguration.kt:93-98` 解析不到就跳过），但本仓的 schema 把「成员不存在」判成整份坏档
   （写入在 `src/bridgePreview.ts:215` 被 `INVALID_SETTINGS` 打回）⇒ 不回写就是「改一次名字之后什么都存不下去」。
6. ~~文件夹同类型内重名 ⇒ 保存前拦下~~ ⇒ **核实后改判为不做**（`[-]`）：上游那两条判据（`:680` 空名、`:684` 同名）
   管的是树里出现**两个同名 FOLDER 节点**；本仓 folder 是记录上的字段，同名必然合并成同一个节点，这个坏状态**不可达**
   ⇒ 加校验等于加一条永远不会红的假门。详见 §3b 与 §6.3 第 6 条。

落地后的实际行号（`wc -l`/`grep -n` 复核过）：

| 子项 | 本仓落点 |
|---|---|
| 唯一名 = 上游 `suggestUniqueName`（`名 (N)`、N 从 1 起、先剥尾部 ` (N)`） | `src/runConfigTree.ts:120-160`（`UNIQUE_NAME_PATTERN:129`、`extractRunConfigBaseName:132`、`uniqueRunConfigName:151`） |
| 新建回落名 = `Unnamed` 的直译（订正自造的「新配置」） | `src/runConfigTree.ts:162-169`（`RUN_CONFIG_UNNAMED_NAME`）+ 对话框 `addConfig`（`uniqueName(RUN_CONFIG_UNNAMED_NAME)`） |
| 重名拦下（上游 apply 那条判据 + 文案直译） | `src/runConfigTree.ts:171-199`（`runConfigNameProblem:184`）+ 对话框 `save()` 的 `:415` |
| 副本：基名 = 源名（去掉自造的「 副本」）、插在源之后 | 对话框 `copyConfig`（`:375` 的 `emit('save', copy, { copyOf: source.name })`）+ `applyRunConfigSave` 的第 3 条规则 |
| 重命名：就地替换原槽位 + 复合成员引用回写 | `src/runConfigTree.ts:201-249`（`RunConfigSaveOrigin:202`、`applyRunConfigSave:226`）+ `src/runConfigurations.ts:196-208` |
| 前身（origin）的传递与认领 | 对话框 `originName`（`:136` 声明、`watch(props.draft)` 里跟随、`addConfig` 清空、`copyConfig` 认领） |
| Before launch 条数后缀（折叠且非空才挂，展开/0 条不挂） | 对话框 `beforeLaunchCount` / `beforeLaunchSuffix`（`:313-317`）+ 折叠头的 `v-if="beforeLaunchSuffix"` |
| 假坐标订正（「zh 文案」两说 + 本仓自造的命名） | `src/runConfigEditors.ts:5-22`（注释）、本档 §0 与 §3b |

规则细节与三处「不补」的判定（副本的 `isManaged` 门、Before launch 的档位三条、同名文件夹校验）写在 §2/§3/§3b/§6.3，
代码注释里逐条带上游「相对路径:行号」。

1. `uniqueRunConfigName(configs, base, scope?)` → 改成 `RunManager.suggestUniqueName` 那条：
   - 未被占用 ⇒ 原样返回；
   - 被占用 ⇒ `extractBaseName`（`(.*?)\s*\(\d+\)`）剥掉尾部 ` (N)`，再 `%s (%d)`，**N 从 1 起**；
   - 作用域：上游按类型子树（`RunConfigurable.kt:1548-1575`、`RunManager.kt:203-206`），本仓名字**全局唯一**（`runConfigurationSchema.ts:115`）⇒ 保持全局，注释里登记这条差异；
   - 新建配置的回落名：bundle `:266` `Unnamed` 直译（现自造 `新配置`）。
2. 副本：base = 源名（去掉自造的 ` 副本`），并把副本记录插到源记录之后（`RunConfigurable.kt:902`）。
3. 重命名：对话框 `emit('save', config, originName)` 第二参 = 表单当前是从哪条记录载入的；
   `saveRunConfigFromDialog(config, origin?)` 里 `origin && origin !== config.name` ⇒ **替换原槽位、保住位置**（上游就地改名，uniqueID 不变）；
   App.vue 的 `@save="saveRunConfigFromDialog"` 会把两个参数都传进来 ⇒ 不需要动保留文件。
4. 重名拦下：目标名已被**另一条**记录占用 ⇒ 报 `dialog.message.run.configuration.already.exists` 的直译（`{0}` = 类型显示名，`{1}` = 名字），在写盘前拦下；不再让整份 `INVALID_SETTINGS` 去打回（`bridgePreview.ts:215`）。
5. 引用回写（登记为本仓差异）：改名时把复合成员里的旧名一起换成新名。
   理由：上游 `CompoundRunConfiguration.kt:93-98` 解析不到就跳过；本仓的 schema 把「成员不存在」判成整份坏档 ⇒ 不回写就是「改了名就再也存不下去」。
6. 文件夹：同类型内重名 ⇒ 保存前拦下（bundle `:68` 直译）；空名继续按「不属于任何文件夹」处理（本仓 folder 是字段不是树节点，与上游 FOLDER 节点不同形，差异登记）。

### 项 2：Before launch 折叠标题的条数后缀按上游可见规则

`before.launch.panel.title.suffix=: {0,choice,1#1 task|2#{0} tasks}`（bundle `:302`）只在**折叠且条数 > 0** 时出现在标题上（`BeforeRunStepsPanel.java:222-227`）。
本仓现在是「N 步」恒显示 ⇒ 换成同一条规则（纯渲染条件，不加控件、不加键）。

## 5. 接线请求（保留文件需别人动的）

见 `docs/wiring-requests-2026-10-06-runcfg4.md`：W1 `persistRunConfigs` 批量入口（Sort Configurations）、
W2 `Show this page`（`isEditBeforeRun`）的持久化键与 `startRun` 消费链路、W3 Store as project file 的 native 侧
（并订正判词口径：上游默认档 `Workspace` 本仓**已等价存在**，缺的只是后两档）。

### 3b. 三档表里被本批**改判**的两行（先核后做的结果）

| 项 | 派单/原判 | 核实后的判定 |
|---|---|---|
| 「Before Launch 任务列表的档位与顺序」 | 候选：做档位 + 顺序 | 顺序 = **不适用**（上游无重排，见 §0 订正留痕）；档位里「无可加任务时整条隐藏」= **不适用**（上游按 provider EP 判，本仓步骤自解释、门恒真）；edit 档 = **不适用**（上游 `provider.isConfigurable()`，本仓步骤直接在文本域改）；**真缺且能做的只有折叠标题的条数后缀** ⇒ 已做（项 2） |
| 「配置副本/重命名的可用性判定」里的 `isManaged` 门 | 候选：照上游补那道门 | **不补**（`[-]`）：`ConfigurationType.java:83-85` 默认 true、全树只有 `UnknownConfigurationType.java:42` 返回 false，而本仓 schema 直接拒未知类型 ⇒ 门恒真 = 假控件（规约 §3）；改做**上游真的在管的那两条**：重名拦下（`:659-666`）与副本/改名的名字与槽位规则 |

## 6. 门禁原始数字

改动文件（前 → 后，`wc -l`；前值 = 本批第一次 `wc -l` 的实测）：

| 文件 | 前 | 后 | 本批净增 | 说明 |
|---|---:|---:|---:|---|
| `src/runConfigTree.ts` | 193 | **315** | +122 | 唯一名 / 重名判据 / `applyRunConfigSave` / `RunConfigSaveOrigin` |
| `src/runConfigurations.ts` | 242 | **245** | +3 | `saveRunConfigFromDialog` 的第二参与一次委托 |
| `src/runConfigEditors.ts` | 256 | **260** | +4 | 只有两处假坐标注释的订正（无代码改动） |
| `src/components/RunConfigurationsDialog.vue` | 667 | **724** | +57 | originName / 副本 / 重名拦下 / 条数后缀 + 注释 |
| `tests/run-config-tree.test.mjs` | 61 | **70** | +9 | 唯一名那条断言按上游形状改写（不放松） |
| `tests/run-config-rename.test.mjs` | — | **132** | 新增 | 本批判据（11 条用例） |

**别用 `git diff --numstat` 读这张表**：工作区是共享的，`git diff` 是**对 HEAD** 的差，里面混着别的 lane 未提交的在途改动
（对话框那一行会报 +144/−18、`src/runConfigurations.ts` 报 +29/−7，都比本批实际写的大）。
本表的前/后是本批自己 `wc -l` 的实测值。

上限：ts/vue 900 / native 1100 ⇒ 本批最大单文件 724，**没有触碰上限，也没改 `tests/module-size.test.mjs`**。
native 侧本批**零改动**（没跑 ctest 的必要，`native/main.cpp`/`settings_schema.cpp` 只读引用）。

### 6.1 指定门禁

- `node --test tests/run-config*.test.mjs tests/run-configuration*.test.mjs tests/jar-run.test.mjs tests/module-size.test.mjs`
  - 改前基线：`tests 54 / pass 54 / fail 0`
  - 改后：**`tests 64 / pass 64 / fail 0`**（新增的 10 条 = `tests/run-config-rename.test.mjs`；`run-config*` 通配把它一起收进来了）
- `npx vue-tsc -b --force`
  - 改前基线：**5 条 error**（10 行输出），全在别人的在途文件：`src/codeLensExtension.ts` ×3、`src/gradleHost.ts` ×1、`src/semanticActions.ts` ×1
  - 改后：**5 条 error，同一批、同一条没变**（`grep -c 'error TS'` = 5）⇒ **本批 0 新增类型错**
    （两份 tsc 输出是临时文件，按规约 §6 收工时删净，数字抄在这里）
  - 这 5 条不是本批引入、也不在本批可改面里（codeLens/gradle/semanticActions 三条 lane 在飞），只登记不修
- `node .tools/find-orphan-modules.mjs --gate`：改前与改后同为
  `门禁绿：没有基线之外的新增零消费方模块。`（已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2）
  本批新增的 4 个导出（`extractRunConfigBaseName`、`RUN_CONFIG_UNNAMED_NAME`、`runConfigNameProblem`、
  `applyRunConfigSave`）全部有消费方：前三个在 `RunConfigurationsDialog.vue`，`applyRunConfigSave` 在
  `src/runConfigurations.ts:200`；两个文件都不是新模块 ⇒ 不产生孤儿。
- `node --test tests/source-citations.test.mjs` ⇒ `tests 3 / pass 3 / fail 0`
  （含「仓里每一条带路径的上游引用都指得到」——本批新增的上游路径:行号全部通过）
- `node --test tests/source-citation-anchors.test.mjs` ⇒ `tests 8 / pass 7 / fail 1`，
  **唯一的红不是本批**：4 条 `moved ::` 全在 `src/commitChecks.ts`、`src/components/ProblemsPanel.vue`、
  `src/runStartupFocus.ts`（三个文件本批一个字没动，`git status` 显示它们被别的 lane 改着）；
  本批新增引用走的是「未入快照 ⇒ 只报数不拦」那一条（`锚点核对：快照 3367 条 / 仓里活引用 3818 条 / 未入快照 455 条`）。
- `node .tools/find-param-props.mjs` ⇒ `共 0 处参数属性`
- `node .tools/find-ts-in-mjs.mjs` ⇒ `干净：tests/*.mjs 全部是纯 JavaScript。`
- `node .tools/find-missing-ext.mjs` ⇒ `干净：没有漏扩展名…`（扫描 1363 个文件）

### 6.2 反向验证（注入 → 变红 → 撤掉 → 复绿）

注入了 **4 处**违规（每处都带本批探针标记），跑 `node --test tests/run-config-tree.test.mjs tests/run-config-rename.test.mjs`：

| 注入 | 位置 | 结果 |
|---|---|---|
| ① 关掉「就地改名」分支（`renamed = false`） | `src/runConfigTree.ts:231` | 红 3 条（改名槽位 / 复合引用回写 / ——） |
| ② 让重名判据永远放行（`if (wanted) return null`） | `src/runConfigTree.ts:187` 之后 | 红 1 条（重名拦下） |
| ③ 「启动前」条数后缀恒显示 | `src/components/RunConfigurationsDialog.vue:316` | 红 1 条（条数规则） |
| ④ 父组件不再把 origin 传下去 | `src/runConfigurations.ts:200` | 红 1 条（接线锚点） |

- 注入后：**`tests 17 / pass 12 / fail 5`**（5 条红 = 上面四类注入的并集）
- 四处逐字撤销后：**`tests 64 / pass 64 / fail 0`**（指定门禁集）
- 残留自查：`grep -rn "RUNCFG4" src native tests scripts | wc -l` = **0**
  （唯一含该标记的文本是本档 §6.2 与 `docs/` 里的约定行，代码零残留）

### 6.3 做不到 / 无法核实（具体卡在哪一环）

1. **「Store as project file」的三档落盘**：卡在 `native/projects_test.cpp:281` 的设计断言 + 三个保留文件
   （新增 native 模块要进 `CMakeLists.txt`、方法联合在 `src/bridge.ts`、分派在 `native/main.cpp`）⇒ W3。
2. **「Show this page」（`isEditBeforeRun`）**：卡在「每条配置一个布尔」必须同时进 `src/settingsModel.ts` 与
   `native/settings_schema.cpp` 的 known_keys（两个都是保留文件），且消费点在 `src/runActions.ts`（保留）⇒ W2。
3. **`Sort Configurations`**：卡在对话框只有单条 `save` 事件，批量写口 `persistRunConfigs` 没被 `src/App.vue:2563`
   那行传给对话框 ⇒ W1（比较器本批**没**提前写，因为没有消费链路）。
4. **`Runner.CloseView`/布局族、`RemoteRunProfile` 族**：与运行配置 UI 同族但都要 daemon/宿主层，口径 §0 已划给独立批次。
5. **中文措辞**：本地树**没有任何 `*_zh*.properties`**（`find` 0 命中）⇒ 本批新出现的三句中文
   （`未命名` = `Unnamed`、`类型为「…」的运行配置已存在：名字「…」。` = `{0} with name ''{1}'' already exists`、
   `：N 项任务` = `: {0,choice,1#1 task|2#{0} tasks}`）**全部是英文原文直译**，不是上游中文文案；
   `configuration.edit.before.run` 那一格的提示语在 bundle 里根本没有键 ⇒ **无法核实**（见 W2）。
6. **同名文件夹的「重名校验」**：原判「半成品 → 本批改」，核实后改判 `[-]`——上游那两条
   （`RunConfigurable.kt:680` 空名 / `:684` 同名）针对的是**树里两个 FOLDER 节点**撞名；本仓 folder 是记录上的一个字段，
   同名必然合并成同一个节点（`runConfigTree.ts` 的 `buildRunConfigTree`），**这个坏状态在本仓不可达** ⇒ 加校验就是加一条永远不会红的假门。

## 7. 本批文件面与在飞观察

**本批动过的全部文件**（别的都没碰）：
`src/runConfigTree.ts`、`src/runConfigurations.ts`、`src/runConfigEditors.ts`（只有注释订正）、
`src/components/RunConfigurationsDialog.vue`、`tests/run-config-tree.test.mjs`、
新增 `tests/run-config-rename.test.mjs`、新增 `docs/batch-2026-10-06-runcfg4.md`、
新增 `docs/wiring-requests-2026-10-06-runcfg4.md`。
未 commit、未 push，未用 `git checkout/reset/stash/clean`。

**保留文件在 `git status` 里显示 `M` 都不是本批所为**（`src/App.vue`、`src/bridge.ts`、`src/settingsModel.ts`、
`src/runActions.ts`、`src/components/CodeEditor.vue`、`scripts/verdict_table.py` 都是别的 lane 在途改的）。
本批唯一依赖的那句接线已经核过还在原位：`src/App.vue:2563` 的
`<RunConfigurationsDialog … @save="saveRunConfigFromDialog" …>` —— 它把 emit 的**全部**实参传给处理函数，
所以第二个参数（origin）不需要动这个文件就能落地（判据里钉了这句，别人改回去会立刻红）。

**并发 lane 的在飞红（只登记，不修）**：`node --test tests/source-citation-anchors.test.mjs` = 7 pass / 1 fail，
四条 `moved ::` 分别指向 `src/commitChecks.ts`、`src/components/ProblemsPanel.vue`、`src/runStartupFocus.ts`
（本批一个字都没动这三个文件）。主引用门 `tests/source-citations.test.mjs` 3/3 绿。

**注入观察（规约 §9）**：本批的工具结果里没有出现伪装成系统/主代理的停手指令或「已改好」类假事实；
两次 `MEMORY.md 已被修改` 通知与三次后台任务完成通知都按**数据**处理，没有据此改变动作。
派单给的坐标里核实为**错**的是两处（`src/bridge.ts` 说 1 行、仓内注释的「上游有 zh 包」），已在 §0 留痕订正；
派单说的 `native/settings_schema.cpp:1011-1012`（jar 白名单）**成立**，我自己一度把它写成「需要订正」的那句过头话原地收回（见 §0 第一行）。
探针标记只在 §6.2 那四处注入里出现过，已逐字撤销：
`grep -rn "RUNCFG4" src native tests scripts` = **0**。
