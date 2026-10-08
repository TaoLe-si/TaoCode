# vcslogdisp — VCS 日志面「显示档 + 图形折叠」剩余项（§C 1-3 / 4 / 7 的显示档那一半）— 工作记录

> 本 lane 只补 `vcslogeclose`（`docs/batch-2026-10-06-vcslogeclose.md`）**没覆盖的那几档**：
> `src/vcsLogDisplay*` 一族的**显示档位**与**图形选项**。
> 判决行升档**不写**（`docs/inventory/verdict-vcs.md` 由主代理统一处理），本文件只给「哪几条可升 + 三栏证据」。

## 0. 接手实况与归属
复核时间：2026-10-06，工作树 = HEAD `200232e`，本 lane 不提交。

**先读 `docs/batch-2026-10-06-vcslogeclose.md`（207 行）后的接手判定** —— 它已钉死的不是我重做一遍的对象：

| §2 编号 | 项 | vcslogeclose 的结论 | 本 lane 动/不动 |
|---|---|---|---|
| 1 / 2 | `CollapseGraphAction` / `ExpandGraphAction` | 可升 `[x]`，本体在 `src/vcsLogGraph.ts` 的 `collapseFragments()` 一族 | **不动**（`vcsLogGraph.ts` 在只读名单里） |
| 3 | `CollapseOrExpandGraphAction` | 只可升 `[~]`；"快捷键"是判决行的编造（注册表 `xml:193-194` 两条 id 无 `<keyboard-shortcut>`），模态进度无宿主 | **不动**（换文案在 `vcsLogGraphOptions.ts`，只读） |
| 4 | `ShowLongEdgesAction` | 可升 `[x]`，归属 = **vcslog3**（磁盘时钟 13:33 之前已在盘） | **不动**；本 lane 只复核它给的坐标 |
| 7 | `CompactReferencesViewAction` | **只可升 `[~]`**，三处缺口点名"不属 vcsloge ⇒ 不动实现" | **这就是本 lane 的活**：① `labelsComparator` 排序、② 组内其余引用留在组里可达、③ 引用串可用宽度 1/3 档 |

mtime 自查（`ls --time-style`）：`vcsLogGraph.ts` 16:00、`vcsLogGraphOptions.ts` 15:18、`VcsLogTable.vue` 15:18、
`HistoryPanel.vue` 15:42、`vcsLogDisplay.ts` 14:10、`vcsLogPresentation.ts` 14:12、
`tests/vcs-log-presentation.test.mjs` 14:04、`tests/vcs-log-graph-cells.test.mjs` 15:58
⇒ 与 vcslogeclose §2 那张"磁盘时钟"表一致；`HistoryPanel.vue` 15:42 落在 vcsloge 窗口（15:14–15:19）之后、
它自己那次 15:58 测试改动之前 ⇒ 本 lane **没碰** `HistoryPanel.vue`（它不在本切片的消费链上，见 §2）。

本 lane 实际改的文件（5 个 + 2 个文档）：`src/vcsLogPresentation.ts`、`src/components/VcsLogTable.vue`、
`tests/vcs-log-presentation.test.mjs`、`tests/vcs-log-menu.test.mjs`（只改那条 chip 右键的接线形状判据，见 §3 第 8 条）、
本文件、`docs/wiring-requests-2026-10-06-vcslogdisp.md`，外加 `docs/source-todo.md` §11 末尾**追加**一段本批的未落登记
（没有改写那批历史条目；`tests/main-toolbar-focus.test.mjs` 与 `tests/usage-view-gear.test.mjs` 也读这份文档，
追加后两份复跑 19/19/0 确认没碰坏别人的判据）。**新建模块 0 个**（⇒ 无"新模块必须有消费方"的欠账）。

## 1. 上游核对（含假坐标留痕）

树根 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`，逐条 `sed -n` 实读。

### 1.1 主代理给的三条"已核实坐标"——我自己开文件复核
| 说法 | 我测的 | 结论 |
|---|---|---|
| `showLongEdges` 真身在 `VcsLogUiPropertiesImpl.kt:121-122`，**不在** `VcsLogApplicationSettings.kt:106-122` | `sed -n '119,124p'` ⇒ `:121` = `@get:OptionTag("LONG_EDGES_VISIBLE")`、`:122` = `var isShowLongEdges = false`；`grep -n "LONG_EDGES\|isShowLongEdges" VcsLogApplicationSettings.kt` ⇒ **0 命中** | 成立（订正正确）；`src/vcsLogPresentation.ts:96-100`、`:124-128` 现在写的就是这两处，无需再改 |
| `FragmentGeneratorTest.kt` 的 helper 在 `:138-139` 且 `strict=false` | `sed -n '135,142p'` ⇒ `:135` `class MiddleNodesTest {`、`:136-139` 是四条 `getMiddleNodes(…) assert "…"`（`simple` / `empty` / **`withDownRedundantBranches:138`** / **`withUpRedundantBranches:139`**） | **行号对、说法要收窄**：`:138-139` 不是"一个传 `strict=false` 的 helper"，是**两条用例**；`strict` 那半在同文件的 helper 定义里（本 lane 不吃那两个期望串，只借形状 ⇒ 与 vcslogeclose §3 末尾那句留痕一致，不再重复断言） |
| `CollapsedGraph.java:26-29` 的 `updateInstance` 按节点 id 带走可见性与 DOTTED 附加边 | `sed -n '24,32p'` ⇒ `:26` 签名、`:27` `getNodeVisibilityById()`、`:28` `new CollapsedGraph(newDelegateGraph, myMatchedNodeId, visibleNodesId, myEdgeStorage)`、`:29` `}` | 成立（`myEdgeStorage` 就是那条 DOTTED 附加边的载体）；本 lane 不改它 |

### 1.2 本 lane 真正钉的上游（§2 #7 显示档三缺）
**(a) 排序 = `GitLabelComparator`**（`plugins/git4idea/backend/src/log/GitRefManager.kt`）：
- 消费点 `groupForTable:93-132`：`:96` `ContainerUtil.sorted(references, labelsComparator)` —— **先排序，再 `groupBy { it.type }`**（`:97`）；
  `labelsComparator` 的声明在 `:40`（`GitLabelComparator(repositoryManager)`），接口面 = `VcsLogRefManager.getLabelsOrderComparator()`（`platform/vcs-log/api/src/com/intellij/vcs/log/VcsLogRefManager.java:58`）。
- 档位表 = `GitLabelComparator.orderedTypes:191-200`：`HEAD, CURRENT_BRANCH, MASTER, ORIGIN_MASTER, LOCAL_BRANCH, REMOTE_BRANCH, TAG, OTHER`；
  私有枚举 `RefType:172-180`（声明序与档位序**不同**，别照它排）。
- 归档 = `GitRefComparator.getType:248-258` + `GitLabelComparator.getType:202-210`：`HEAD`→HEAD、`TAG`→TAG、
  `LOCAL_BRANCH` 且名字 `== master|main` → MASTER、`REMOTE_BRANCH` 且 `== origin/master|origin/main` → ORIGIN_MASTER、
  否则 LOCAL/REMOTE、其余 OTHER；**LOCAL/MASTER 里再认当前分支**（`isCurrentBranch:212-216` → CURRENT_BRANCH，升档到 MASTER 之前）。
- 比较三步 = `GitRefComparator.compare:235-246`：先 `ArrayUtil.find(orderedTypes, type)` 的差 ⇒ 再
  `GitReference.REFS_NAMES_COMPARATOR`（`plugins/git4idea/shared/src/git4idea/GitReference.kt:55` = `NaturalComparator.INSTANCE`）⇒ 再 `VcsLogUtil.compareRoots`。
- 名字档 = `platform/util/base/src/com/intellij/openapi/util/text/NaturalComparator.java`：`compare:19-27` 走
  `naturalCompare(s1, s2, len1, len2, **ignoreCase = true**, **likeFileNames = false**)`；主循环 `:45-97`
  （数字段：跳空格 `skipChar(..., ' ')` 再跳前导零 `skipChar(..., '0')` ⇒ 先比**有效位数** `:58`、再逐位 `:62`、
  再比**含前导零/空格的总长** `:66`、最后比前导部分 `:70`）；非数字走 `compareChars:116-122`
  （**transitivity fix**：一方是空格、另一方落在 `' '`~`'0'` 之间 ⇒ 空格算**大**）；收尾 `:100-105`
  （一边没走完 ⇒ 长的算大；长度差；`ignoreCase` 时**再来一遍 `ignoreCase=false`**）。
  单字符不等的忽略大小写口径 = `platform/util/base/src/com/intellij/openapi/util/text/Strings.java:45-67`
  （先 `c1-c2`；忽略大小写时先比大写、大写相等再比小写）。
- **本仓没有的那个输入**：`isCurrentBranch` 要 `repository.currentBranch`。本仓的真源在
  `native/git.cpp:438-447`（`head(repo)` = `rev-parse --abbrev-ref HEAD`，detached 时回 `(分离于 …)`），
  经 `git.status` 的 `GitStatus.head`（`src/vcsLogTypes.ts:5`）出，`src/vcsLogData.ts:194` 那句
  `request<GitStatus>('git.status')` **已经在调**（现在只取 `.branches`）⇒ 状态源是真的，缺的只有
  `src/components/VcsLog.vue`（本 lane 名下之外）那一行 prop ⇒ 见 §7 接线请求，不硬造。

**(b) 组 = `SimpleRefGroup.buildGroups`**（`platform/vcs-log/impl/src/com/intellij/vcs/log/impl/SimpleRefGroup.kt:27-49`）：
- compact 且没有预组（tracked/current）时 `:33-37`：**所有**引用并进**一个**组，组名 =
  `if (firstRef.type.isBranch || showTagNames) firstRef.name else ""`；compact 且有预组时 `:38-39` 组名 = `refGroups.first().name`。
- 非 compact `:43-49`：`isBranch` 的类型**每个引用自己一组**（名字就是引用名），非分支类型（tag/other）**全部并成一组**，
  组名 = `showTagNames ? refsOfType.first().name : ""` ⇒ "3 个 tag 也只画一枚 chip"这一档本仓此前没有。
- `isBranch` 的逐类型真值 = `GitRefManager.kt:272/275/278` = **true**（HEAD/LOCAL_BRANCH/REMOTE_BRANCH）、`:281/284` = **false**（TAG/OTHER）。
- 多引用组有**两色底** = `SimpleRefGroup.getColors:18-23`（`:21` `if (references.size > 1) listOf(color, color)`）。
- 其余引用"可达"的宿主 = **悬停 chip 区域的那枚 tooltip**：`GraphCommitCellRenderer.kt:84-103`（`refs = cell.refsToThisCommit` =
  这一行的**全部**引用，且只在标签那一段 x 范围内回组件、范围外回 `null`）→ `LabelPainter.createTooltip:440-451`
  → `TooltipReferencesPanel.java:35-56`（`REFS_LIMIT = 10` 在 `:36`，`:51` 用 `getLabelsOrderComparator()` **再排一次**）
  → 基类 `ui/details/commit/ReferencesPanel.java:61-107`（首 10 条画出来、`getHiddenReferencesSize:116-118` 出余数、
  `createRestLabel:120-122`）。文案两处 key（`platform/vcs-log/impl/resources/messages/VcsLogBundle.properties`）：
  `:131` `vcs.log.references.more.tooltip=... {0} more in details pane`（tooltip 用这一条）、
  `:261` `vcs.log.details.references.more.label=... {0} more`（详情面板用另一条）。
  `LabelPainter.createTooltip:441-447` 那一支 **detached head 警告**（`vcs.log.references.detached.head.tooltip`，
  `VcsLogBundle.properties:358`）要 `myWarningRange`（画师自己的排版产物），本仓没有对应物 ⇒ 登记不做，不放假的警告图标。

**(c) 宽度档 = `GraphCommitCellRenderer.getAvailableWidth`**（`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/render/GraphCommitCellRenderer.kt:274-287`）：
`textAndLabelsWidth = 列宽 − graphWidth`（`:275`）、`freeSpace = textAndLabelsWidth − 主题的 preferredWidth`（`:276`）、
compact ⇒ `min(freeSpace, textAndLabelsWidth / 3)`（`:277-278`）、非 compact ⇒ `max(freeSpace, max(宽/2, 宽 − DISPLAYED_MESSAGE_PART))`
（`:280-283`，常量 `DISPLAYED_MESSAGE_PART = 80` 在 `:321`）、最后 `max(0, …)`（`:285`）。
列宽在本仓的真源 = `src/components/VcsLogColumns.vue:13-17`（canvas `measureText` + `fitColumns`，
`--commit-width` 由 `:56` 铺成 CSS 变量），主题的 preferredWidth 同处才量得到 ⇒ **本切片落不了这一档**，
逐条原因与要谁配合写在 §7。


## 2. 落盘

改动的四个文件（外加本文件与 `docs/wiring-requests-2026-10-06-vcslogdisp.md`、`docs/source-todo.md` §11 末一段补记）：

### `src/vcsLogPresentation.ts`（+`logRefsToShow` 退役）
| 出口 | 行 | 钉住的上游 |
|---|---|---|
| `LOG_REF_TIERS` | `:227` | `GitRefManager.kt:191-200` 的 `orderedTypes`（八档，**不是**同文件 `RefType:172-180` 的声明序） |
| `logRefIsBranch()` | `:236` | 同文件 `:272/275/278` = true、`:281/284` = false |
| `logRefTier()` | `:248` | `GitRefComparator.getType:248-258` + `GitLabelComparator.getType:202-210`（当前分支升档）+ `MASTER/MAIN/ORIGIN_MASTER` 常量 `:279-282` |
| `naturalCompare()`（私有）/ `naturalCompareRefNames()` | `:308` / `:342` | `NaturalComparator.java:37-106`（`compare:19-27` 传 `ignoreCase=true, likeFileNames=false`）+ `Strings.compare:45-67`；`GitReference.kt:55` 是接上点 |
| `compareLogRefs()` | `:352` | `GitRefComparator.compare:235-246` 三步（第三步 `compareRoots` 在本仓恒 0，单根） |
| `LogRefGroup` / `logRefGroups()` | `:372` / `:374` | `SimpleRefGroup.kt:27-49`（compact `:32-39` / 非 compact `:41-49`）+ `GitRefManager.kt:93-132`（`:96` 排序、`:100` 摘 HEAD、`:122-124` 并回第一组、`:129` 只剩 HEAD 时给空名组） |
| `LOG_REF_TOOLTIP_LIMIT` / `logRefTooltip()` | `:419` / `:420` | `TooltipReferencesPanel.java:36`（`REFS_LIMIT = 10`）+ `ReferencesPanel.java:61-118`（首 10 条 + `getHiddenReferencesSize`）+ `VcsLogBundle.properties:131` |
| 旧 `logRefsToShow()` | **已删** | 它把"取第一个"写在扁平数组上（`slice(0,1)`），既没有排序也没有"其余引用留在组里"这一层；组模型是它的超集，判据逐条搬过去并加严（见 §3） |

文件头那张上游成员表里 `Vcs.Log.CompactReferencesView` 那一行（`:12`）已改成本批的状态（三截里落了两截、第三截卡在哪）。

### `src/components/VcsLogTable.vue`
| 位置 | 内容 |
|---|---|
| `:17` | 新增可选 prop `currentBranch?: string`（§7 请求 1 的那一行就接在这里） |
| `:70`–`:90` | `LogRefChip` + `chipsOf()`：一行画几枚 chip、chip 的次序、组名、组内多于一条时的 tooltip，全交 `logRefGroups()`/`logRefTooltip()` 算，组件不自己排 |
| `:92` | `emitRefMenu()`：右键交回的是**组头**那一条引用，`emit('refMenu')` 的载荷形状一字未改（`{name, type}`，`VcsLog.vue:46/88` 那侧不用动） |
| `:252-253`、`:256-257` | 两支模板（`AlignLabels` 的 `.labels` 列 + inline）都改成 chip = 组名 + `:title="chip.tooltip \|\| undefined"` |

**消费链**（不是孤模块）：齿轮那一行 `VcsLog.vue:252`（`:compact-references`）→ `VcsLogTable.vue:82 chipsOf()` →
`logRefGroups()` → `compareLogRefs()` → `naturalCompareRefNames()`；tooltip 落 `:253/:257` 的 `title`；
右键菜单落 `:92` ⇒ 每一个新出口都有生产消费方，**没有**新模块、**没有**只被测试吃的出口。
`src/vcsLogGraph.ts` / `src/vcsLogGraphOptions.ts` 本批只读引坐标（`:106-107`、`:155`、`vcsLogGraphOptions.ts:206-221`），一个字没动。

## 3. 判据（`tests/vcs-log-presentation.test.mjs`，另动 `tests/vcs-log-menu.test.mjs` 一条）

新增四条 + 改写两条，每条都单独验过"能红"（见 §4）：

1. `引用画哪几枚：紧凑档 = 一个组一枚 chip，标签名称档不给 tag`（`:143`）—— 原 `logRefsToShow` 那四断**逐字保留成组名清单**
   （`[main, origin/main]` / `[main]` / `[main]` / `[]`），再加两条 `inside()`：紧凑档 `refs = [main, origin/main, v1.0]`
   全在同一组里（`SimpleRefGroup.kt:33-37`）、非紧凑档 isBranch 各自一组（`:44-45`）。
2. `引用的次序 = GitLabelComparator 那八档，不是 git 的 refname 字典序`（`:160`）—— 钉 `LOG_REF_TIERS` 逐字八档、
   chip 序 `['main','beta','origin/feature','v2']`、HEAD 并进**第一组**（`GitRefManager.kt:100 + :122-124`）、
   两个 tag 并成一枚 chip 且组内 `v2` 在 `v10` 前（natural，git 自己的 `%D` 会反过来）、紧凑档组名是 `main` 而不是 `HEAD`。
3. `CURRENT_BRANCH 那一档：要仓库状态，给了就升到 MASTER 之前`（`:185`）—— 不给值 = 该档不参与 / 当前分支叫 main 时
   CURRENT_BRANCH 盖过 MASTER（`:204-208`）/ 给了 `release` 时第一枚 chip 变成 `release`。
4. `名字档 = NaturalComparator（ignoreCase=true, likeFileNames=false）那三步收尾`（`:197`）—— 七断：数字段比值、
   位数多的算大、走不完的一边算大、忽略大小写相等后再来一遍区分大小写、空格 vs `0x21–0x2F` 的 transitivity fix、
   前导零走**含前导零总长**那一步、以及 `'v10' vs 'v9x'`（只有真走过"位数"那一步才回正）。
   **这一条里我自己错过一次、也真抓到一次**，两件事分开记：
   · 期望值错在我：先把 `007 vs 7` 断成 `< 0`（把 `'007'` 读成"三个零 ⇒ 有效位数 0"）。跑红后按上游重算：
   两个前导零 + 一个 `'7'` ⇒ 有效位数 1 vs 1 相等 ⇒ 数字相等 ⇒ 第三步比**含前导零的总长** ⇒ `007` 排后面。
   **改的是断言的期望值（照上游重推），没有动移植、也没有放松断言**（同一位置现在钉的是那一步真的发生）。
   · 移植里确实有个真 bug：那次重算时手推 `skipChar` 发现自己写的嵌套调用**漏传了 `text` 实参**
   （`skipChar(skipChar(…), length1, '0')` ⇒ 退化"从不跳前导零"，`start` 恒等于串长）。已改正
   （`src/vcsLogPresentation.ts:315-316`），并补了 `'v10' vs 'v9x'` 这一枚**只有走对数字段才分得开**的输入钉住它
   （其余常见输入上两版同值 —— 逐例核过：`v2/v10`、`feature/10 / feature/2`、`007/7` 都是巧合同值，所以先前那批断言钉不住它）。
5. `组内其余引用可达 = 悬停 chip 的 tooltip，十行封顶（TooltipReferencesPanel）`（`:211`）—— `REFS_LIMIT` 逐字 = 10、
   13 条 ⇒ 11 行（10 + 余数那一行）、刚好 10 条不补余数行、空组不给一枚空 tooltip、余数行文案对 `VcsLogBundle.properties:131`。
6. `tooltip 挂在行上、紧凑档只画一枚 chip 而组内其余引用挂在 chip 的 title 上（SSR 渲真组件）`（`:269`）—— 渲真组件断
   紧凑档 chip 文本**逐字 = `['main']`**、其 title 解码 = `HEAD\nmain\nbeta`；非紧凑 = `['main','beta']` 且 title
   只有第一枚（`['HEAD\nmain','']`，单引用组不补）；再对 `alignLabels` 那**另一支模板**同样断一遍（`:292-295`）。
   原写法是 `!compact.includes('beta')` —— 这一批把组内其余引用合法地放进了 title 属性，那条断言的**等价对象**已经变了，
   于是换成"只取 chip 元素的文本再逐字比"（`chipTexts()`，与既有 `:260` 那条同一口径），**没有放松**：
   它现在同时管住"没多画 chip"和"少画的确实还在"，而老写法两样都管不住（老写法下把 beta 彻底删掉也是绿的）。
7. 接线形状那一条（`:343`）：`logRefGroups(commit.refs ?? []`、`:title="chip.tooltip || undefined"`、
   `tooltip: group.refs.length > 1 ? logRefTooltip(group.refs) : ''`、`currentBranch: props.currentBranch` 四条整段正则。
8. `tests/vcs-log-menu.test.mjs:83`：原 `@contextmenu.prevent.stop="emit\('refMenu'` 改成钉 `emitRefMenu(chip, $event)`
   **并且**加一条钉 `emit('refMenu', { name: chip.head.name, type: chip.head.type`（菜单契约仍是"那一条引用"）—— 两条都比原条紧。

## 4. 反向验证（7 次注入，每次都先看红再还原）

探针前缀 `VCSLOGDISP-PROBE-n`，注入点与红数（跑 `node --test tests/vcs-log-presentation.test.mjs tests/vcs-log-menu.test.mjs`，
该两文件基线 30 条 / 全绿）：

| 探针 | 注入 | 结果 |
|---|---|---|
| 1 | `LOG_REF_TIERS` 里 `master`/`originMaster` 换位 | **2 红**（八档那条 + 组模型那条：chip 序变 `origin/feature` 在前） |
| 2 | `naturalCompare` 的数字段闸门加 `false &&`（退化成逐字符） | **2 红**（natural 那条 + 八档那条：tag 组内变 `v10` 在前） |
| 3 | 不摘 HEAD（`headRefs = []`、`rest = sorted`） | **2 红**（八档那条 + SSR 那条：紧凑档第一枚变 `HEAD`、非紧凑多画一枚） |
| 4 | 非紧凑档不给 tag 并组（`if (true \|\| logRefIsBranch(ref))`） | **1 红**（八档那条：tag 组散成两枚 chip） |
| 5 | `LOG_REF_TOOLTIP_LIMIT` 10 → 13 | **1 红**（tooltip 那条：行数与常量两处都抓） |
| 6 | 两支模板都摘掉 `:title="chip.tooltip \|\| undefined"` | **2 红**（SSR 那条 + 接线形状那条） |
| 7 | `skipChar` 的嵌套调用改回"漏传 `text`"那一版 | **1 红**（名字档那条，红的正是新加的 `'v10' vs 'v9x'` 那一断 ⇒ 这枚输入确实钉住了移植的实参） |

还原后：`grep -rn "VCSLOGDISP" src tests native docs/inventory` = **0 命中**；
`sha1sum` 对回注入前基线 —— `src/vcsLogPresentation.ts` `20cc39e0…`、`src/components/VcsLogTable.vue` `6e9a06cc…`
两份**逐字相同**（两份测试文件的 sha1 变化只发生在探针之前的正常补判据阶段，探针期间未改）。
另：临时隔离配置 `.tsconfig.vcslogdisp.json` 用完即删，盘上不存在。
（口径提醒：`grep -rn VCSLOGDISP docs` 会有 4 处命中，全部是**本报告 §4 这张表自己在写探针名**；
代码与判据侧的核对按 `src tests native docs/inventory` 走 = 0。）

## 5. 门禁原始数字（本 lane 自己跑的，收工前）

| 命令 | 结果 |
|---|---|
| `node --test tests/vcs-log*.test.mjs tests/vcs*.test.mjs` | **102 / 102 / 0**（vcslogeclose 收工基线 98 + 本批新增 4 条；收工前连跑两次同值） |
| `node --test tests/vcs-log*.test.mjs tests/vcs*.test.mjs tests/module-size.test.mjs` | **107 / 106 / 1** —— 唯一那条红是 `已登记的 native 大文件不许继续变大`， offender = `native/history.cpp 现在 935 行 > 上限 910`（**不是本批的**，见下面两段留痕） |
| `node .tools/find-missing-ext.mjs` | 干净：扫 1386 个文件，无漏扩展名、无静态解析不到的相对 import |
| `node .tools/find-orphan-modules.mjs --gate` | **门禁红 1**：新增零生产消费方模块 = `src/components/CodeActionPopup.vue`（**不是本批的**：本批新建模块 0 个；该文件 15:04 mtime、属 quickfix/弹层一族在飞文件）。已登记孤儿 6 / 基线 8 · 本轮清掉 2 |
| 隔离 `npx vue-tsc --noEmit -p .tsconfig.vcslogdisp.json`（include = `src/vcsLogPresentation.ts` + `src/components/VcsLogTable.vue`） | **0 error** |
| `grep -rn "VCSLOGDISP" src tests native docs/inventory` | **0 命中** |

**三条 foreign 在飞红的留痕（只记录、没替别人修）**：

1. `native/workspace.cpp` 1482 > 上限 1385（17:02 被改着）⇒ 第一轮 `module-size` 红；随后**自愈**
   （单跑 `tests/module-size.test.mjs` = 5/5/0）；收工前复跑又红，但 offender 换成 `native/history.cpp` 935 > 910
   ⇒ 同一族 native 仍在被另一条 lane 推着长。两个文件都不在本 lane 名下。
2. `src/speedSearch.ts`（17:18/17:20 在飞）一度让 `速度搜索只比可见的元数据列` 红：
   `ReferenceError: speedSearchMatcherPattern is not defined`（`src/speedSearch.ts:154`，那一版全文 0 处该标识符 ⇒ 半途重命名）。
   本 lane 的判据**只是调用** `speedSearchMatches`（既有的第三条，不是本批新写的），没碰那个文件；
   17:20 之后那条红随它自己写完而消失（vcs 闸 102/102/0）。留此一句，免得后面把它当本批的账。
3. `npx vue-tsc -b` 全仓**没跑**：并发期它会把语义检查遮掉（vcslogeclose §6 同一口径），所以用上面的隔离配置。

本批名下的两份源文件收工时 sha1 = 探针前基线（`20cc39e0…` / `6e9a06cc…`），测试文件两份为最终判据版本。

### 可升档（判决行的升档由主代理改，本 lane 只给三栏证据）

| 项 | 结论 | 三栏证据 |
|---|---|---|
| §2 #7 `CompactReferencesViewAction`（§C `:83`）里"排序"与"其余引用可达"这两半 | **本批已落**，可把 vcslogeclose §2 #7 那三条缺口划掉两条 | 上游 `GitRefManager.kt:96 + :190-216 + :235-246`、`NaturalComparator.java:37-106`、`SimpleRefGroup.kt:32-49`、`GraphCommitCellRenderer.kt:84-103` + `TooltipReferencesPanel.java:35-56`；本仓 `src/vcsLogPresentation.ts:227-421` + `src/components/VcsLogTable.vue:70-92/252-257`；判据 §3 的 1/2/3/5/6/7 六条 |
| §2 #7 的整体判词 | 仍**只能 `[~]`**（不是 `[x]`）：第三半"列宽 1/3 档"未落（§6），CURRENT_BRANCH 档的供给侧未接（§7 请求 1） | 同上；缺口逐条在 `docs/source-todo.md` §11 末与本文件 §6 |
| §2 #1/#2/#3/#4 | 本批**未参与**，归属与升档结论以 `docs/batch-2026-10-06-vcslogeclose.md` §5 为准（#1/#2 `[x]`、#3 `[~]` 且"快捷键"要删、#4 `[x]` 但记 vcslog3） | 本批只复核过它给的坐标（§1.1 三条），没动实现 |

## 6. 未落 / 无法核实（逐条给原因，不放假控件）

1. **引用串可用宽度档（列宽 1/3）—— 没做**。两个入参都不在表格这一层：提交列宽度与主题 preferredWidth 只在
   `src/components/VcsLogColumns.vue:13-17` 的 canvas 测量里算得出，而它只把结果铺成 CSS 变量（`:56`），**无数值出口**；
   用 `calc(… / 3)` 近似只能做出"1/3"那一半，`min(freeSpace, …)` 与 `max(0, …)` 两步（`GraphCommitCellRenderer.kt:277-278/285`）
   仍无处可取 ⇒ 按纪律不铺半截档，公式与要谁配合写在 §7 请求 2。
2. **CURRENT_BRANCH 档没有供给侧** ⇒ 闸门入参（`logRefTier(ref, currentBranch?)`）不给值时那一档不参与。
   真源是存在的（`native/git.cpp:438-447` → `GitStatus.head`，`src/vcsLogTypes.ts:5`），但**当前唯一在调它的地方是懒路径**
   （`src/vcsLogData.ts:190-198`，第一次要补全候选才发）⇒ 拿它当供给会让 chip 选择随"用户开没开过弹层"变，那是渲染不确定；
   所以宁可不接，请求写在 §7 请求 1（含 detached 时该交 `undefined` 的口径）。
3. **tracked 对子与预组**（`GitRefManager.kt:104-114` 的 currentBranch 预组、`:300-330` 的 `getTrackedRefs`/`createTrackedGroup`，
   组名形如 `origin & main`）：本仓 `native` 不回 tracked 关系 ⇒ compact 走的是 `SimpleRefGroup.kt:33-37` 那一支
   （无预组），`:38-39` 那一支（有预组时组名 = `refGroups.first().name`）**没实现**，已在 `logRefGroups` 文档注释登记。
4. **detached head 那一族**（`DetachedHeadRefGroup`、`isOnBranch`、`LabelPainter.createTooltip:441-447` 的
   `vcs.log.references.detached.head.tooltip` 警告 = `VcsLogBundle.properties:358`）：要 `repository.isOnBranch`
   与画师自己的 `myWarningRange`（排版产物），两样本仓都没有 ⇒ 不做，也不放一枚假警告。
5. **多引用组的两色底**（`SimpleRefGroup.getColors:18-23`，同色两条带；`TooltipReferencesPanel.java:70-88` 靠它加宽 icon）：
   本仓 chip 只有单色边框 + 文字色，没有 icon/双色面 ⇒ 没铺；`LogRefGroup` 因此**不带** `colors` 字段（不留一个没人吃的模型面）。
6. **`showTagNames === false` 时 tag 的画法**：上游是"仍成组、组名给空串"（`SimpleRefGroup.kt:36/47`），本仓沿用既有口径
   "整条摘掉"（`logRefGroups` 第一行），这是**既有**差异（vcslogeclose §2 #7 也按此判），本批没改判据也没顺手"修"它。
7. **只有 HEAD 一条引用时**：上游给一枚空名组（`GitRefManager.kt:129`），靠 icon 撑着；本仓 chip 没有 icon 面 ⇒ 组名写回 `HEAD`
   （代码里就地登记，不假装等价）。
8. **非 BMP / 大小写会展开的字符**（如 `ß`）：Java `Character.toUpperCase(char)` 是一对一，JS `String.toUpperCase` 可能变两个码元
   ⇒ `naturalCompare` 取 `[0]`，常规 ASCII/中文引用名逐步等价，边缘字符可能与上游不同序（在函数注释里登记）。
9. **§2 #3 那条"快捷键"与本批无关**，但复核结论一致：注册表里 `Vcs.Log.CollapseAll`/`ExpandAll` 无 `<keyboard-shortcut>` ⇒ 不存在。

## 7. 接线请求

见 `docs/wiring-requests-2026-10-06-vcslogdisp.md`：**2 条要别人配合**
（① `VcsLog.vue:251-252` 补 `:current-branch`（含供给侧为何不能走懒路径的口径）；② `VcsLogColumns.vue` 给列宽与
`measure()` 出口，才能落"列宽 1/3"那一档），外加一张"本批**不要**的接线"表（`bridge.ts` 0 行未动、`App.vue` 未动、
判决行升档归主代理、`HistoryPanel.vue` 不在消费链上所以未动、两个只读图形文件）。

## 8. 现场异常（工具结果里的注入文本，一律当数据）

本 lane 遇到 **2 次**"MEMORY.md 被修改"的系统提示（都在工具结果里，第 4 次与第 20 次调用附近），
形态是"文件自上次读取后被改动 + 一列表项摘要"。**处置：当数据，不据此改行为**——
读盘核对方式：本 lane 的判据与红线全部来自盘上文件与本仓库文档，与那两条摘要无依赖关系；
它也没有要求本 lane 执行任何动作（不像上一轮同族 lane 收到的那两条互相矛盾的伪造 user 轮次）。
其余全部工具结果正常。**没有**遇到"停手/预算已到/已改好"一类注入句，也没有出现需要还原的伪指令。

盘上自查（收工时）：`grep -rn "round limit|externally modified|system advisory" src/vcsLogPresentation.ts src/components/VcsLogTable.vue`
= 0 命中 ⇒ 注入没有进文件；探针标记 `VCSLOGDISP-PROBE-*` 7 处全部撤回（§4 的 grep = 0 命中）。

**名下文件之外**：`docs/inventory/*` 在本次会话期间被别的 lane 改着（`git status` 里从 4 项涨到 10 项，含
`actions_verdict_table.json`、`find-diff_verdict_table.json` 等），本 lane 一个字没动那里（特批归 `ledgerfix`）。

