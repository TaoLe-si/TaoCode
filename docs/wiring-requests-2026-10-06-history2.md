# wiring-requests-2026-10-06-history2 — 本地历史族（只写请求，native 侧本批不动）

出处：`docs/batch-2026-10-06-history2.md`（同批）。上游参考树 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
每条都给了上游坐标与本仓落点；**都不许在本仓前端造"设置了但不生效"的假档**（本批已核实：目前本地历史一个持久化键都没有，判据 `tests/history-revert.test.mjs` 的「本地历史没有假档」一条会在有人只加键位时红）。

## R-HIST2-1 保留期：按 `localHistory.daysToKeep` 裁剪快照（缺键补默认）

上游事实（逐条开文件核过，见批档 §2）：

- 唯一的保留期设置是 **advancedSetting**，不是注册表键、不在设置页：
  `platform/lvcs-impl/resources/intellij.platform.lvcs.impl.xml:133`
  `<advancedSetting id="localHistory.daysToKeep" default="5" groupKey="group.advanced.settings.ide"/>`
- 文案：`platform/ide-core/resources/messages/ApplicationBundle.properties:876-878`
  （`Duration of storing changes in Local History` / 警告 description / trailingLabel `days`）。
- 唯一消费者：`platform/lvcs-impl/src/com/intellij/history/core/ChangeListImpl.kt:19`（键名）、
  `:20`（`DEFAULT_DAYS_TO_KEEP = 5`）、`:114-121`（`flush()` → `purgeObsolete(period)`）、
  `:128-136`（读不到键才回落 5）。
- 清理算法不是"墙钟差"：`platform/lvcs-impl/src/com/intellij/history/core/ChangeList.kt:22-23` 的默认第二参
  = `:42` 的 `12.hours`；`platform/lvcs-impl/src/com/intellij/history/core/PersistentChangeListStorage.kt:308-328`
  从新往老累加，相邻两次快照间隔 `<12h` 累真实毫秒、`≥12h` 只加 `1`（"跨天算一天"），累计 `≥ period` 起切。

本仓缺口：`native/history.cpp` **完全没有按时间清理**——只有条数裁剪
（`:587` 的 `while (versions.size() > max_versions_)` 丢最旧；默认 `native/history.hpp:27` 的 50；
`native/main.cpp:688` 构造时不吃任何设置值）。⇒ 两年的快照也照样列出来。

请求（两种落点，任选其一，语义都对得上）：

1. 简单版：`History` 构造再收一个 `days_to_keep`（缺省 5，来自 `settings.update`/`project.settings` 里**新增**的键位），
   在 `record()` 现有的 `trim()` 旁边再加一道"按 `timeMillis` 丢超出天数的旧快照（连带删快照字节）"。
2. 精确版：照抄上游的累加规则（间隔 ≥12h 记 1，否则累真实毫秒），把"5 天"变成"5 天活跃时长"。

**硬约束（必须遵守，本仓踩过）**：新增键位一律**缺键补默认**，不许按键数/字段数判损坏——
读盘路径参照 `src/settingsInspector.ts` 的 `normalizeSettingsShape`（缺失 = 用默认、未知键丢并记 issue）。
在 native 消费方落地**之前**，前端不许先摆设置项或高级设置条目。

判据建议（native 侧）：`native/history_test.cpp` 加一条"第 6 天的快照被裁掉、第 4 天的留着"，
再钉一条"没有该键时按 5 天工作"。前端侧的对应断言已在 `tests/history-revert.test.mjs`
（「上游保留期就一个 advancedSetting」一条现在钉的是 *本仓没有按天过期实现*，native 落地后把这条改成钉消费点）。

## R-HIST2-2 revert 之前先保存全部未保存文档

上游 `platform/lvcs-impl/src/com/intellij/history/integration/revertion/Reverter.kt:42-47`：
写命令里 `saveAllUnsavedDocuments() → doRevert() → saveAllUnsavedDocuments()`。

本仓 `src/components/HistoryPanel.vue` 的会话/单行直写只碰磁盘版本，看不到 Tab（Tab 归 `src/App.vue`，冻结中）。
现状不是静默覆盖：脏缓冲随后保存会撞宿主那句 `CONFLICT`（`native/workspace.cpp:928`）并由
`src/appSaveFailure.ts` 提示"重新载入磁盘版本 / 保留当前修改"。
请求：给前端一个"存全部脏文档"的入口（新桥方法或 `app.state` 的既有通道），前端再在 revert 前调用它。
**这条需要动 `src/App.vue` 与 `src/bridge.ts`（都在保留清单里）⇒ 本批不申请，只登记。**

## R-HIST2-3 只读的"询问解除"

上游 `platform/lvcs-impl/src/com/intellij/history/integration/revertion/Reverter.kt:24-31` 的
`checkCanRevert()` 只有一项：`askForReadOnlyStatusClearing()` → `IdeaGateway.ensureFilesAreWritable`
（问用户要不要解除只读，拒绝才回 `revert.error.files.are.read.only`）。
本仓现在只做前置检查并拒绝，文案复用 `src/appSaveFailure.ts:26-28`（本仓唯一权威句）。
请求：宿主提供"解除只读并写"的一次性动作（`file.readOnly` 目前只能设/取，没有带用户确认的组合动作）。

## R-HIST2-4 重命名 / 删除的复原通道（保持禁用，不是缺陷修复）

上游 `platform/lvcs-impl/src/com/intellij/history/integration/revertion/DifferenceReverter.kt:50-52`
的 `doRevert()` 会 `revertRename` / `revertDeletion` / `revertCreation`——因为它把
`RenameChange`/`DeleteChange`/`CreateEntryChange` 当事件存着。
本仓宿主按**当前路径**存快照，没有事件通道 ⇒ 直接往旧路径写会凭空造文件。
`src/historySessions.ts` 的 `revertRouteFor` 因此把这类行判成 `none`（按钮禁用 + tooltip 说清原因）。
请求：若真要对齐，需要 native 记 rename/delete 事件（`history.record` 的 `reason` 已经有 "revert"/"external" 位），
前端已按"事件缺失"写好分支，落地时只需把 `missingFromDiskPaths` 的来源换成宿主的事件表。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R-HIST2-1（保留期裁剪）** —— native + `settingsModel.ts`（保留），非本 lane。
- **R-HIST2-2（revert 前保存全部）** —— `src/App.vue` + `src/bridge.ts`（保留），非本 lane。
- **R-HIST2-3 / R-HIST2-4** —— 宿主/native，非本 lane。

结论：零接线（全部非本 lane）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（全部非本 lane）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
