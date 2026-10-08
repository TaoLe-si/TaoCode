# batch histdays — 本地历史「按天过期」（2026-10-06）

## §0 接手实况
（待填）

## §1 上游核对（含订正留痕）
（待填）

## §2 落盘（文件 + 净行数）
（待填）

## §3 判据与反向验证
（待填）

## §4 门禁原始数字
（待填）

## §5 无法核实
（待填）

## §6 接线请求
（待填）

## §0 接手实况

- `git status --porcelain -- src tests native docs`：本人名下 `native/history.cpp`/`history.hpp`/`history_test.cpp`
  **均无工作区 diff**；`CMakeLists.txt`、`src/historySessions.ts` 有他人改动（并发 lane），`tests/history-revert.test.mjs` 未跟踪。
- **判"有没有做"是靠打开文件读实现，不是看 diff**：`native/history.cpp:585-591` 的 `trim` 循环体只有
  `while (versions.size() > max_versions_)` 一条判据 —— 按天过期在 HEAD 里**确实不存在**（不是"commit 了看不出来"）。
- 消费方核对：`native/main.cpp:688` `std::make_unique<taocode::history::History>(store)` 单参构造，走
  `history.hpp:27 default_max_versions_per_file = 50`，不吃任何设置 —— 派单这条坐标核实为**真**。
- **既有判据会因本改动转红（关键现场）**：`tests/history-revert.test.mjs:161-164` 断言的是"宿主**没有**按天过期"
  （`assert.doesNotMatch(native, /daysToKeep|retention|expire/i)`）。它是上一 lane 为"别在 UI 里谎报"钉的**现状哨兵**，
  不是结构约束；实现落地后必须改写这两句，否则会误红。
- 门禁基线（接手时原样）：`node --test tests/history*.test.mjs tests/pv-history*.test.mjs tests/module-size.test.mjs`
  → **tests 26 / pass 26 / fail 0**。
- `grep -c add_test CMakeLists.txt` **接手时实测 40，不是派单说的 39**（40 条清单见 §4 订正）；基线按 40 起算。
- `tests/` 下真实文件名核实：无 `src/localHistory*`（派单给的 glob 落空）；历史族是
  `src/historyFollow.ts`、`src/historySessions.ts`、`src/historyTimeline.ts`；
  `tests/history*.test.mjs` 命中的是 `tests/history-revert.test.mjs`（`clipboard-/commit-message-/debug-*/doc-/find-replace-/scratch-/search-history` 属别的族，不在名下、不动）。
- 在飞红（不属本人、不修）：`native/workspace.cpp` 1482 > 上限 1385 归 `linesep2`；本次 module-size 仍 4 条绿，说明它已被登记在案的上限覆盖，如实记录接手即为绿。

## §1 上游核对（逐条自己开树数，含订正留痕）

树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
`third_party/intellij-community` 实测**只剩一个空 `.git`**（`ls -la` 只有目录本身 + `.git`），本轮未引用。

| 派单给的坐标 | 自己开树读到的 | 结论 |
| --- | --- | --- |
| advancedSetting `localHistory.daysToKeep` 默认 5，`platform/lvcs-impl/resources/intellij.platform.lvcs.impl.xml:133` | `:133 <advancedSetting id="localHistory.daysToKeep" default="5" groupKey="group.advanced.settings.ide"/>` | **符** |
| 文案 `ApplicationBundle.properties:876-878` | 真实路径 `platform/ide-core/resources/messages/ApplicationBundle.properties`，`:876 Duration of storing changes in Local History`/`:877 …description…IDE hangs`/`:878 …trailingLabel=days` | **行号符**；派单只写了文件名没写目录，补全 |
| 唯一消费者 `ChangeListImpl.kt:19-20/:114-136` | `:19 DAYS_TO_KEEP_PROPERTY_KEY`、`:20 DEFAULT_DAYS_TO_KEEP = 5`；`flush()` `:114-125` 里 `:117 getDaysToKeep()`、`:118 daysToKeep.days.inWholeMilliseconds`；`getDaysToKeep()` `:127-136` | **符**（细分见右） |
| 清理口径非墙钟差：`ChangeList.kt:22-23/:42` | `:22 purgeObsolete(period, intervalBetweenActivities)`、`:23` 默认第二参、`:42 DEFAULT_INTERVAL_BETWEEN_ACTIVITIES_MILLISECONDS = 12.hours` | **符** |
| `PersistentChangeListStorage.kt:280`、`:308-328` | `:280 override fun purge(...)`；`:308-329 findFirstObsoleteBlock`，`:321 length += if (delta < intervalBetweenActivities) delta else 1`、`:323 if (length >= period) return last`、`:300 deleteRecordsUpTo(firstObsoleteId)` | **符** |
| 容量那棵树没有任何设置键（`LocalHistoryConfiguration` 全树 0 命中） | 全树 `grep -rn LocalHistoryConfiguration` → **0 命中**；`daysToKeep` 全树只 5 处（xml/properties×3/ChangeListImpl×2）+ 一个测试文件 | **符** |

**订正 1（口径的精确性，派单与原 doc 都说"≥12h 记 1 天"）**：`PersistentChangeListStorage.kt:321` 加的是字面量 `1`，
累加器 `length` 的单位是**毫秒**（与 `period` 同单位才能比 `:323`）。所以准确说法是「间隔 ≥12h 时只累加 **1 毫秒**」，
`:320` 的注释把它*称作*一天（"add '1' between two 'days'"）。差别有后果：跨过夜间/周末的空档**几乎不计龄**，
`period=5 天` 实际是"5 天的活动时长"，不是"5 个自然日"。移植按字面 `+1` 实现，不改成 `+1 天`。

**订正 2（锚点，派单未提）**：`findFirstObsoleteBlock` 从 `getLastRecord()`（最新）往回走，`:315` 第一条把
`prevTimestamp` 置成它自己的时间戳 ⇒ `delta=0`。**基准是最新一条快照的时间戳，不是墙钟 `now`**；
一条都不写的老项目永远不会因为"现实时间过了 5 天"而被清。移植同样以 newest 为锚。

**新发现（派单与原 doc 都未登记的第五个上游文件）**：`platform/lvcs-impl/testSrc/com/intellij/history/core/LocalHistoryFlushMissingAdvancedSettingTest.kt`
（IJPL-248209）钉的是"`advancedSetting` EP 缺 `localHistory.daysToKeep` 时 flush 不许抛 `IllegalArgumentException`"；
对应实现 `ChangeListImpl.kt:127-136` **catch 后回落到 `DEFAULT_DAYS_TO_KEEP=5`**。这正是"缺键必须补默认、不许按字段数判损坏"的上游先例。
