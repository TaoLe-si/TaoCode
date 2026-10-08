# batch-2026-10-06-usageexport — 用法视图「导出到文本文件」

> 骨架先落盘，逐块追加。工作目录 `D:\TaoCode`。
> 硬约束：只动 `src/usageViewExport.ts`(新) / `src/referenceContents.ts` / `src/components/ReferencePanel.vue` / `tests/`。
> `bridge.ts`(0 贴顶) / `App.vue` / `CodeEditor.vue` / `native/**` / `usageViewTreeModel.ts` / `usageViewGrouping.ts` / `src/menus/**` 禁写。

## 0. 接手实况

**上游坐标（自己 find + 打开核过的，参考树 = `D:/Backup/Downloads/intellij-community-master/intellij-community-master`；`third_party/intellij-community` 未用）**

| 任务书给的候选 | 实际读到 | 结论 |
|---|---|---|
| `platform/usageView-impl/src/com/intellij/usages/impl/ExporterToTextFile.java` | 同路径**存在**，97 行，`com.intellij.usages.impl.ExporterToTextFile implements com.intellij.ide.ExporterToTextFile` | 候选成立，逐行见 §1 |
| （未点名）接口本体 | `platform/platform-api/src/com/intellij/ide/ExporterToTextFile.java:11-32`（`getReportText`/`getDefaultFilePath`/`exportedTo`/`canExport`） | 四格契约在这份接口上，本模块照它对齐 |
| 动作侧 | `platform/platform-impl/src/com/intellij/ide/actions/ExportToTextFileAction.java:17-25` → `platform/platform-impl/src/com/intellij/ide/util/ExportToFileUtil.java:58-102`（`chooseFileAndExport` → 已存在则「覆盖/追加/取消」→ `FileWriter(UTF_8)` → `exporter.exportedTo(...)`） | 落盘在宿主；见 §2 |
| 上游断言（黄金样本） | `platform/platform-tests/testSrc/com/intellij/usages/impl/UsageViewTest.java:262-270` 的 `assertEquals` 全文 | 输出形状**逐空格**照它抄，见 §1 末 |
| 「结尾统计」 | 上游这条导出**没有结尾统计行**（黄金样本止于最后一条用法行）；总数那一格是**根组行** `Usages  (1 usage found)`（indent 0） | 任务书这一条候选不成立 ⇒ 留痕：本仓根不可见（`UsageViewTreeCellRenderer.java:88-89`），统计改放结尾一行，措辞复用既有 `usagesFoundText`/`usageSummary` |
| `errorTreeText(..., {details})` 住在 `src/referenceContents.ts` | 实际在 `src/errorTree.ts:193`；`referenceContents.ts` 里没有它，导出只在 `src/components/ProblemsPanel.vue:543-558` 调 | 候选不符，按实际读到的走（本仓「文本导出 = 屏幕上那棵 + `dialog.saveFile` + `app.writeExportFiles`」的既有形状就是这一条） |

**本仓现状（mtime 自查，接手时）**：`src/usageViewTreeModel.ts` 10-06 16:08、`src/usageViewGrouping.ts` 16:01、`src/referenceContents.ts` 16:02、`src/usageViewGear.ts` 16:07、`src/components/ReferencePanel.vue` **12:36**（本轮名下唯一还没被动过的）、`src/bridge.ts` 14:52、`src/App.vue` 13:18。
既有导出**两份**：`usageViewGrouping.ts:675-685` `exportUsageTreeText`（吃**树**，自己 `flattenUsageTree`，不经行模型 ②③④）与 `:363-370` `exportUsagesText`（平表）。`referenceContents.ts:292-294` 的 `exportReferencesText` 生产侧**零消费方**（`grep -rn exportReferencesText src/` 只有声明本身；消费全在 `tests/usage-view-panel-rows.test.mjs:156/200/332`）⇒ 面板 `ReferencePanel.vue:79-84` 工具条只有「全部展开/全部折叠/过滤」，没有导出。这正是 R-2 的成因。
**本批做法**：新建 `src/usageViewExport.ts`（吃 `UsageTreeRow[]`/`UsageTreeModelRow[]`，不再走树）→ `referenceContents.ts` 的 `exportReferencesText` 改由它出 → `ReferencePanel.vue` 画真按钮（落盘通道确认存在，见 §2 ⇒ 不是假控件）。

## 1. 上游输出形状逐行（`platform/usageView-impl/src/com/intellij/usages/impl/ExporterToTextFile.java`，97 行全文开过）

| 行 | 原文形状 | 抄法 |
|---|---|---|
| `:25-29` `getReportText()` | `appendNode(buf, myUsageView.getModelRoot(), System.lineSeparator(), "")` | 整份文本 = 逐节点拼 + **行分隔符**（`\n` 写文件，见 §2）；`src/usageViewExport.ts` 的 `usageExportText` 缺 `\n`、可传 `lineSeparator` |
| `:31-47` `appendNode` | **先** `buf.append(indent)`；`node.getParent() != null` 才打这一行并令 `childIndent = indent + "    "`（`:35`，**四个空格**），根只把缩进往下传（`:38-40`）；随后按 `node.children()` 顺序递归 | 根不打印 = 本仓 `flattenUsageTree` 的既有档（`depth` 从 0 起）；缩进 = `'    '.repeat(row.depth)`；**行序照 `referenceRows` 原序，导出侧不再排第二次** |
| `:49-52` | 被排除的节点前缀 `"(" + usage.excluded + ") "`（`UsageViewBundle.properties:90` `usage.excluded=excluded`） | 本仓没有「排除用法」这一态（`Node.isExcluded` 无对应数据源）⇒ 不实现，登记 §5 |
| `:57-63` GroupNode | `group.getPresentableGroupText()` → `buf.append(" ")`（`:60`）→ `" (" + usages.n(getRecursiveUsageCount()) + ")"`（`:61-62`）⇒ **组文本与左括号之间是两个空格** | 组行 = `label + " (" + usagesFoundText(row.count) + ")"`。⚠ 两个空格 vs 本仓既有**一个空格**（`exportUsageTreeText:682` 与三条既有断言）⇒ 不另造第二份形状，保持一个空格，统一请求写 §6 |
| `:64-66` UsageTargetNode | `target.getPresentation().getPresentableText()` | 本仓无 target 层（`usageViewTreeModel.ts:85-89` 已登记：`UsageTargetNode` 挂在 `UsageViewTreeModelBuilder.java:40-69` 的 `TargetsRootNode` 下、宿主没接）⇒ 无行可打 |
| `:67-69` | 其余 `node.toString()` | 不抄（本仓行都是已呈现的行） |
| `:73-81` `appendUsageNodeText` | 遍历 `TextChunk[]`；`chunkCount == 1` 时先补一个空格（注释 `// add space after line number`）再拼余下 chunk | 叶子行 = `indent + 位置文本`。上游 chunk0 = **行号**（`ChunkExtractor.java:361` `String.valueOf(lineNumber + 1)`）、其后 = 那一行的正文（同文件 `:336`），`computeText` 见 `UsageInfo2UsageAdapter.java:184-214`。本仓叶子文本是 `行:列`（`usagePositionText`，`usageViewGrouping.ts:423-425`），**正文行拿不到**（行模型里没有文本；登记 §5） |
| `:84-86` `getDefaultFilePath` | `myUsageViewSettings.getExportFileName()` | 记忆上一次导出的整条路径（本仓 `taocode.usagesExportFileName`，见 §2） |
| `:88-91` `exportedTo` | `setExportFileName(filePath)`（`ExportToFileUtil.java:66` 在写完之后回调） | `rememberUsageExportPath(path)` |
| `:93-96` `canExport` | `!myUsageView.isSearchInProgress() && myUsageView.areTargetsValid()`（`UsageViewImpl.java:1863`/`:2174`） | `canExportUsages({searching, targetsValid, rows})`：`searching` = 面板 props（`ReferencePanel.vue:44-45`）、`targetsValid` = 选中的那条 Content 还在 |

**黄金样本逐空格核对**（`UsageViewTest.java:262-270`，Java 文本块按闭合分隔行 indent=19 剥离后的真实缩进）：

```
Usages  (1 usage found)                      ← 根组（model 根 TargetsRootNode 不打印）
    Unclassified  (1 usage found)            ← 用法类型档
        light_idea_test_case  (1 usage found)← Module 档
              (1 usage found)                ← 包档：文本为空 ⇒ 12 空格 + `:60` 的那个空格 + ` (` ⇒ 观测到 14
                  X.java  (1 usage found)    ← 文件档（depth 4 = 16 空格）
                      1 public class X{ int xxx; } //comment   ← 叶子（depth 5 = 20 空格）＝ 行号 + 空格 + 正文
```
⇒ 缩进是纯 4 空格一层（`14` 那一行不是例外，是空文本 + 两个空格的合成），组行计数用**子树合计**（`getRecursiveUsageCount`，本仓 `row.count` 同一格），叶子 = 行号 + 一个空格 + 正文。

## 2. 落盘
（待填：既有宿主写文件通道的真实方法名与调用链）

## 3. 判据与反向验证
（待填：USAGEEXPORT 前缀判据清单，注入→红→还原→sha1→grep 0 残留）

## 4. 门禁原始数字
（待填）

## 5. 无法核实
（待填：zh 本地化包缺失 ⇒ 中文措辞）

## 6. 接线请求（给主代理）
（待填：`src/menus/toolWindowGear.ts` 齿轮行请求）
