# 接线请求 —— 桶 status2defect（2026-10-06）

这三条都卡在**保留文件**或**别人名下文件**里，本批一律没动。每条给：目标文件 + 目标行号 + 可照抄的整段替换 + 上游依据 + 不做的后果。

---

## W1　`pf/progress` 判词里「本仓任务不能暂停」这句已经过期（唯一真源在 `scripts/verdict_table.py`）

**为什么现在错**：本仓已经有 `src/progressSuspender.ts`（`ProgressSuspender` + `ProgressSuspenderTracker` 的单线程等价物）、
队列侧 `setSuspended/isSuspended`（`src/backgroundTasks.ts:274-285`）、面板那一行 `queueRow`（`:345-374`），
并有判据 `tests/progress-queue-suspend.test.mjs`（4 条，收工 `4 / 4 / 0`）。"不能暂停"这个说法会让人以为整族没做。

**目标 1（唯一真源，保留文件）**：`scripts/verdict_table.py:348`，`"pf/progress"` 那条 reason 字符串里。
被替换的整段（逐字，含反引号）：

```
挂起-恢复（`ProgressSuspender`/`ProgressSuspenderTracker`/`TaskToProgressSuspenderSynchronizer`；本仓任务不能暂停）
```

替换成（逐字可照抄，不含双引号，不破坏 Python 字符串）：

```
挂起-恢复已落：`src/progressSuspender.ts`（`ProgressSuspender.java:79-81` 的 markSuspendable、`:106-110` 临时 reason 优先、`:121-137` suspendProcess、`:139-152` resumeProcess、`:154` freezeIfNeeded 的单线程等价物 `awaitResumed()`）+ 队列侧 `setSuspended`/`isSuspended`（响应式挂起原因 `src/backgroundTasks.ts:184`）+ 面板那一行 `queueRow`（原因按 `TaskSuspension.kt:24-25`、`TaskInfoEntityCollector.kt:174` 的口径显示在进度那一行上，恢复的对称面 `:177`），判据 `tests/progress-queue-suspend.test.mjs`；还差：任务体一侧的协作检查点（唯一入队消费者 `src/gradleHost.ts` 那条 run 不带 indicator ⇒ 挂起对它的实际效果只有"不再开新任务"）与 `TaskToProgressSuspenderSynchronizer` 那种双向同步
```

**目标 2（同一句在文档里的那一份，保留文件）**：`docs/inventory/verdict-platform_rest.md:171`
—— 内容与 `scripts/verdict_table.py:348` 那条字符串逐字相同（`grep -c "本仓任务不能暂停"` 在这两个文件各命中 1 / 生成物 `docs/inventory/platform_rest_verdict_table.json` 命中 34 处 reason）。
改了脚本后用仓里既有的生成路径重算这三处即可；**只改文档不改脚本** ⇒ 下次生成必然被覆盖回去（这就是为什么我把脚本写在目标 1）。

**上游依据**（本批逐行打开核过，参考树内）：
`platform/progress/shared/src/suspender/TaskSuspension.kt:24-25`（suspendText 那句注释：*"…which is displayed in the progress bar"*）、
`platform/platform-impl/src/com/intellij/openapi/progress/impl/ProgressSuspender.java:121`（reason *"is displayed in the UI … until the progress is resumed"*）、
同目录 `TaskInfoEntityCollector.kt:174` / `:177`（`pauseTask(task, suspender.suspendedText, Source.USER)` / `resumeTask`）。

---

## W2　挂起原因的**显示源**只有一个：`queueRow` 读队列级 ref，而挂起器自带的那句兜底显示不到（连带 `text()`/`suspendedText` 两条零消费）

**现状**（本批逐行数过）：
- 面板那一行的文案来自 `src/backgroundTasks.ts:364-367` 的 `queueSuspendReason.value`；
- 队列给挂起器构造的那句兜底 `'等待前台操作'`（`:230-236`）走的是 `ProgressSuspender.suspendedText`（`src/progressSuspender.ts:49`）→ `text()`（`:53`、`:86`，上游 `getSuspendedText()` 的投影，`ProgressSuspender.java:106-110`）；
- 但 `text()` 与 `suspendedText` 在全仓（`src` + `tests` + `native`）**零消费方**（`grep -rn "suspender\.text"` 无命中）⇒ 那句兜底永远不会出现在界面上，而 `queueRow` 里的 `已挂起：<原因>` 只跟着队列级 ref；
- 副作用：已挂起时把原因从 A 改成 B，`queueRow` 会说 B，而挂起器自己还停在 A（`src/progressSuspender.ts:89` 那句早退 = 上游 `ProgressSuspender.java:125` 同语义）。今天不可观测（唯一触发点 `src/notifications.ts:298` 只做 `reason ↔ null`），但两条通道迟早会漂。

**请二选一**（都要动 `src/progressSuspender.ts` 或 `src/backgroundTasks.ts`，本批不能替主代理定）：

1. **接上上游口径**（推荐，`getSuspendedText()` 本来就是给那一行用的）：`queueRow` 的文案改成"正在跑的那条的挂起器优先，没有挂起器（只有排队的）时用队列级原因"，即把
   `` `已挂起：${queueSuspendReason.value}` `` 换成 `` `已挂起：${current?.indicator.suspender?.text() ?? queueSuspendReason.value}` ``；
   于是 `'等待前台操作'` 兜底真有消费方、`text()` 不再是死面、A/B 漂移也一并消掉（第一个 reason 赢，直到 resume —— 与 `ProgressSuspender.java:125` 一致）。
   ⚠ 这条要求同时补判据：**响应式依赖仍然只能是 `queueSuspendReason`**（挂起器内部是普通 `let`，`src/progressSuspender.ts:75-78`，它不是 computed 的依赖）——
   即 `queueRow` 的条件与失效靠 ref、只有那句文案的取值走挂起器。写错就退回本批判据钉的那条缺陷（`tests/progress-queue-suspend.test.mjs:84-146`，注入非响应式版本实测红）。
2. **不接**：那 `ProgressSuspender.text()`（`src/progressSuspender.ts:53`、`:86`）与 `suspendedText`（`:49`）就是 §5 禁的"只过自己测试的死面"，按本仓"死代码直接删"删掉，
   并把 `src/backgroundTasks.ts:230-236` 那段注释改成"兜底文案没有显示面，只是给挂起器的构造必填项"。

---

## W3　`src/progressSuspender.ts` 里三条零消费的 tracker 方法（同族死面，别留下批"只过自己测试"的债）

`grep` 结论（`src` + `tests` + `native` + `docs`，逐个方法名单独搜）：

| 符号 | 位置 | 全仓命中 |
| --- | --- | --- |
| `ProgressSuspenderTracker.suspended()` | `src/progressSuspender.ts:150-152` | 只有定义那一行（`suspenders.suspended(` / `.suspended()` 无外部调用；注意别和 `isSuspended()` 混） |
| `ProgressSuspenderTracker.suspendAll()` | `src/progressSuspender.ts:154-156` | 只有定义那一行 |
| `ProgressSuspenderTracker.resumeAll()` | `src/progressSuspender.ts:158-160` | 只有定义那一行 |

**处置**：三条一起删（本仓的挂起是队列级单通道 `setSuspended`，逐任务批量接口没有触发者），
或者在这里给每条写清"为什么必须留"。上游对应面供参考：`ProgressSuspenderTracker.kt` 的批量接口是给 `TaskToProgressSuspenderSynchronizer` 那种双向同步用的，
本仓那条同步没做（见 W1 的"还差"）——**留着它们不等于那条功能就在了**，那是 §3 说的假控件形态。

---

## status3 复核（2026-10-06 桶 status3；报告见 `docs/batch-2026-10-06-status3.md`）

三条**都仍然成立**，本轮逐条按磁盘重数了一遍（`src/progressSuspender.ts` / `src/backgroundTasks.ts` 都不在我的可改面 ⇒ 只复述、不动手）。

| 项 | 判定 | 本轮实测的现场（行号 = 本轮 `grep -n` 取的） |
| --- | --- | --- |
| W1 判词过期 | **仍缺** | `grep -c "本仓任务不能暂停"` ⇒ `scripts/verdict_table.py:348` 命中 1、`docs/inventory/verdict-platform_rest.md:171` 命中 1 ⇒ 原请求里那段可照抄替换**仍然逐字可用**（被替换段的字符串本轮复核一致） |
| W2 挂起原因显示源 | **仍缺** | `src/progressSuspender.ts:48`（`readonly suspendedText`）、`:52`（`text: () => string`）、`:86`（实现 `tempReason ?? suspendedText`）；`grep "suspender\.text"` 在 `src`+`tests`+`native` ⇒ **0 命中**（原写 `:49`/`:53` 各偏一行，按左表订正）。队列侧显示源本轮实测在 `src/backgroundTasks.ts:364-367`（文件自己的注释 `:235` 也指着这两行） |
| W3 tracker 三条 | **仍缺** | `src/progressSuspender.ts:150-152`（`suspended()`）、`:154-156`（`suspendAll()`）、`:158-160`（`resumeAll()`）—— 三个名字在全仓只命中定义那几行 ⇒ 与 W2 同批处理（删或写理由） |

### W2 走"接上上游口径"那条路时的逐字 old/new（本轮按磁盘重取，缩进照抄）

old（`src/backgroundTasks.ts:367`，行首 10 个空格）：

```
          detail: `已挂起：${queueSuspendReason.value}${queuedCount.value > 0 ? `（还有 ${queuedCount.value} 个排队中）` : '（正在跑的那条会在下一个检查点让路）'}`,
```

new（挂起器优先、队列级兜底；`current` 就是 `queueRow` 那个 computed 里已有的当前条目）：

```
          detail: `已挂起：${current?.indicator.suspender?.text() ?? queueSuspendReason.value}${queuedCount.value > 0 ? `（还有 ${queuedCount.value} 个排队中）` : '（正在跑的那条会在下一个检查点让路）'}`,
```

⚠ 原请求那条告诫仍然有效：**响应式依赖只能是 `queueSuspendReason`**（`:184` 是 ref、`:208/:218/:279/:289` 是它的读写点；
挂起器内部是普通 `let`），判据见 `tests/progress-queue-suspend.test.mjs:84-146`。
走"不接"那条路就删 `src/progressSuspender.ts:48/:52/:86` 三个面并把 `src/backgroundTasks.ts:233-235` 那段注释改成"兜底文案没有显示面"。

### 顺带（status3 在本域发现的同类死面，一并登记）

`src/statusBarWidgets.ts:142` 的 `createStatusBarWidgetInstances` 唯一引用者仍是
`tests/status-bar-widget-instances.test.mjs` —— 本仓状态栏组件是 `src/App.vue` 模板里直接渲染的，
没有实例宿主 ⇒ "只过自己测试"那一档。它不在本批可改面（statusbar/status2 名下实现），
要么给它一个 App.vue 侧宿主，要么按"死面直接删"处理；**别新写第三个只给自己测试的入口**。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W1** —— 判词（`scripts/verdict_table.py`），非本 lane。
- **W2（挂起原因显示源）** —— 目标 `src/components/EventLogPanel.vue` / 进度面板（本 lane 可改面），登记。
- **W3（`src/progressSuspender.ts` 三条零消费方法）** —— 本 lane 可改面，登记。

结论：零接线（W2/W3 登记，W1 非本 lane）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（W2/W3 登记，W1 非本 lane）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
