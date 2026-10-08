# 接线请求 · 2026-10-06 · runinst2（运行实例族剩余）

目标文件都在黑名单或保留面里，本 lane 只给请求。
**每条的出口名都先打开目标文件核对过**（核对用的实际行号写在条目里），不存在「按了没反应的假按键」。

上游依据（本 lane 亲自打开参考树核实，路径相对
`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
- `platform/lang-api/src/com/intellij/execution/dashboard/RunDashboardRunConfigurationStatus.java:59-76`
  —— 状态派生：`exitCode == null` ⇒ STARTED；`exitCode == 0 || TERMINATION_REQUESTED` ⇒ STOPPED；否则 FAILED。
- `platform/execution/resources/messages/ExecutionBundle.properties:203`（`Kill process`）、
  `:204`（`Process ID: {0,number,#}`）、`:208`（`Stop ''{0}''`）。
- `platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt:369-376`（**只在进程活着时**设描述）、
  `:401`（结束时 `content.description = null`）。

本 lane 已把上述四格的**真值**算进模型（`src/runDashboard.ts:73-88` 的 `RunDashboardRow.stoppable/kill/stopText/description`，
判据 `tests/run-instance-rows.test.mjs` 新增的第 2、3、5 条）。宿主不接这四格也不会报错 —— 只是继续用
`row.state === 'running'` 这一档，看不出「正在结束途中」，文案也不是上游那句。

---

## W-1 `src/components/MainToolbar.vue` —— 运行仪表盘的停止格读行模型的四格

**为什么值得接**：本仓宿主的 `run.stop` 按 Job Object 杀整棵树，用户点了停止之后进程可能还要几百毫秒才退；
上游这一格在那段时间换成 **Kill process**（`RunDashboardRunConfigurationStatus.java:71-73` 读的就是
`TERMINATION_REQUESTED`）。今天仪表盘这格只看 `state === 'running'`，点了之后外观上没有任何变化 ⇒
用户以为没生效、会再点一次。

**出口名核对**（我实际读到的）：
- `:37` 已从 `'../runInstances.ts'` 导入 `activeRunInstance, focusRunInstance, resolveStopActionTargets, runInstanceList, runInstanceRows`；
  `:38` 导入 `stopActionState, stopChooserItems, stoppableCandidates, STOP_LABELS`。
- `:146` `const dashboardRows = computed(() => runDashboardRows(runInstanceList().map(instance => ({…})), dashboardNow.value))`。
- `:174` `function pickDashboardInstance(id: number)`、`:178` `async function stopDashboardInstance(id: number)`。
- 模板：`:377` `v-for="row in group.rows" … class="run-dashboard-row"`、`:378` 那个 `run-dashboard-pick` 按钮、
  `:383` 那个 `v-if="row.state === 'running'"` 的 `run-dashboard-stop` 按钮（图标 `Square`，`:25` 已导入）。

**改法 1（可照抄）** —— `:383` 那一行整行替换。文案与 kill 档都取模型，`disabled` 也取模型，图标不换
（不新引 lucide 符号，避免主代理去猜导入；上游换的是图标形状，本仓这一档先用文案表达，已比今天多一档状态）：

```vue
                <button v-if="row.stoppable" type="button" class="run-dashboard-stop" :aria-label="row.stopText" :title="row.stopText" :class="{ 'is-kill': row.kill }" @click="stopDashboardInstance(row.id)"><Square :size="iconSize.inline" aria-hidden="true" /></button>
```

**改法 2（必须同批改，否则 `kill` 档永远不会出现）** —— `:178-180` 整段替换：发出停止请求**之前**把这一格标成
「已在结束途中」（`markRunInstanceStopping` 就是上游 `ProcessHandler.isProcessTerminating()` 在本仓的那一份，
`src/runInstances.ts:320-323` 的注释写明「这一格只能由前端在发出请求时自己记」）。
`src/runActions.ts:525` 的 `stopRun` 已经这么做，仪表盘的 `stopDashboardInstance` 漏了 ⇒ 从仪表盘停的实例
永远进不了 kill 档。`markRunInstanceStopping` **不在** `src/bridge.ts` 的再导出清单里（`src/runActions.ts:26-30`
的注释就是这么说的），所以从 `'../runInstances.ts'` 直接导：

```ts
async function stopDashboardInstance(id: number) {
  // 先记「已请求停止」再发请求：这一格要立刻换成 Kill process（ExecutionBundle.properties:203），
  // 否则点了停止外观不变，用户会以为没生效（src/runInstances.ts:320-323 同一条理由）。
  markRunInstanceStopping(id)
  try { await request('run.stop', { instance: id }) } catch { /* 进程可能刚结束 */ }
}
```

并在 `:36-39` 那个 `from '../runInstances.ts'` 的导入清单里加上 `markRunInstanceStopping`
（放在 `focusRunInstance` 之后即可）。

**改法 3（同名两行的区分，可选但建议）** —— `:378` 的 `:title` 今天写 `（PID ${row.pid}）`，
与本仓标签条用的那句（`runInstanceTabDescription` 给的 `进程 ID：N`，直译自 `ExecutionBundle.properties:204`）
不是同一个措辞，而且**进程结束后今天还在写 PID**（上游在 `:401` 把它清了）。模型已经把对的串放在
`row.description`（空串 = 没有 ⇒ 不渲染），照抄：

```vue
                <button type="button" class="menu-button run-dashboard-pick" role="menuitem" :title="`切到${row.title}${row.description ? `（${row.description}）` : ''}`" @click="pickDashboardInstance(row.id)">
```

样式若加 `.is-kill`：**不要写裸 hex**，走既有令牌；本 lane 不指定颜色（上游换的是图标不是颜色，
`AllIcons.Debugger.KillProcess`，`ShowRunningListAction.java:150-152`）。

判据同步点：`tests/run-dashboard.test.mjs:49-56` 那条「接线」断言里有
`assert.match(toolbar, /request\('run\.stop', \{ instance: id \}\)/)` —— 改法 2 保留了这一句，锚点不会红。
若主代理把 `v-if="row.state === 'running'"` 换成 `row.stoppable`，`tests/run-dashboard.test.mjs` 里没有钉这一行的断言，
但 `src/runDashboard.ts` 侧的判据已经钉住 `stoppable/kill/stopText/description` 四格算得对。

---

## W-2 `native/run_host.cpp` + `src/runInstances.ts` —— 进程结束**归因**要一列真状态源

这一条是 §0 表里那个 `[~]`，**卡点很具体**，不是「太复杂」：

上游把「谁结束了进程」放在 `ProcessHandler` 的 `TERMINATION_REQUESTED` 用户数据上
（`RunDashboardRunConfigurationStatus.java:71-73` 读的就是它），所以「用户停的」与「自己退的」是两个正交事实。
本仓这个事实只有宿主知道，而宿主现在用**一个重载的 `aborted` 布尔**表达三件不同的事（我逐行读过）：

| 行 | 发的内容 | 实际含义 | 本仓今天给的档位 | 上游档位 |
|---|---|---|---|---|
| `native/run_host.cpp:309` | `code:-1, aborted:true` | 用户点了停止（`stop_instance`） | 已停止 ✔ | STOPPED ✔ |
| `:406-407` | `code:-1, aborted:true` | `Manager::stop(0)`（关项目/退出） | 已停止 ✔ | STOPPED ✔ |
| `:321-322` | `code:<真实非零>, aborted:true` | **启动前链某步失败 ⇒ 链被中止** | 退出码 N（failed）✔ | FAILED ✔ |
| `:338-339` | `code:-1` + `{"error", …}`，**无 aborted** | **起进程抛 `WorkspaceError`** | **已停止** ✗ | **FAILED** |
| `:345` | `code:-1`，**既无 aborted 也无 error** | **起进程抛 `std::exception`** | **已停止** ✗ | **FAILED** |

⇒ 用户看得见的问题：一个配置**根本没起来**（命令写错、exe 不存在），仪表盘/标签条却显示「已停止」，
把失败说成了人为停止。要修对必须有「是不是有人请求停止」这一列真状态源，而现在 `code:-1` 是**唯一**线索，
它同时被「用户停」和「起不来」两条路复用 ⇒ 纯前端无法分辨，我不猜。

**需要的最小改动**（二选一，第一个更贴上游）：
1. `native/run_host.cpp` 把 `:338-339` 与 `:345` 那两条 `code` 从 `-1` 改成一个**不与停止哨兵相撞**的负值
   （或直接只靠 `{"error", …}` 与新增的 `{"spawnFailed", true}`），让「起不来」在事件里可辨；
   `:345` 那条要补上 error 字段。⇒ 这要改 native（本 lane 不可改，且 `native/main.cpp`/`CMakeLists.txt` 是保留文件；
   改 `run_host.cpp` 的活应归 native 侧的 lane）。
2. 或者前端记 `terminationRequested`：在**发出** `run.stop` 时（`src/runActions.ts:525` 与 W-1 改法 2 那处）
   除了 `markRunInstanceStopping` 之外把「这次结束是我请求的」写进记录，`handleRunExit` 用它而不是 `exit === -1`
   定档 ⇒ 能覆盖 `:309/:406`，但**盖不住** `:345`（那条本来就没有任何停止请求，能盖住的前提是「前端知道没请求过」，
   而这恰好是 `exit === -1` 单哨兵做不到的）。

前端那半边我已经备好：`src/runInstances.ts:554-560` 的 `runInstanceState(running, exit)` 与
`src/runDashboard.ts:114-116` 的 `stateOf` 已经收敛成**一份**实现，加一列 `terminationRequested`
只需要在那一处加参数 + 在 `handleRunExit`（`src/runInstances.ts:243-279`）里存下 `data.aborted`。
我没做是因为：现有断言（`tests/run-dashboard.test.mjs:31/36`、`tests/run-instance-rows.test.mjs:377`）
钉的是 `exit === -1 ⇒ stopped`，在宿主没给出新状态源之前，把它改成「只有请求过停止才算 stopped」
会让 `:338/:345` 那两条路从「已停止」变成「已停止」——**没变好**，却把 `:309` 那条改红（因为前端此刻也拿不到
`:309` 的「请求过」与「没请求过」的差别，快照与事件是两条通道）。等 W-2 的宿主列落地再一次性改，判据我留在
`tests/run-instance-rows.test.mjs` 的注释里（第 5 条判据已钉住「只有一份实现」，改的时候只需改那一处）。

---

## W-3 `src/runInstances.ts:572-581` —— 注释坐标订正（单行，净 0 行）

`runInstanceTabDescription` 的注释写着「上游 `:369-376` 与 **`:402`**」。我实际读
`platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt`：
`content.description = null` 在 **:401**（`:400` 是 `content.icon = if (icon == null) executor.disabledIcon else IconLoader.getTransparentIcon(icon)`，
`:402` 是那个 `}`）。`:369-376` 那段是对的。

请把 `:575` 那行的 `:402` 改成 `:401`。`src/runDashboard.ts` 里我新写的注释已经按 `:401` 落。
（该文件只剩 30 行余量，本 lane 不悄悄改，避免和同一文件上的其它 lane 撞行。）

## 处理结果（wiring-backlog lane，2026-10-06）

- **W-1（`MainToolbar.vue` 停止格读行模型）** —— 本 lane 可改面，登记。
- **W-2（native 归因列）** —— native + `src/runInstances.ts`，登记/非本 lane。
- **W-3** —— 注释订正。

结论：零接线（登记）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（登记）。」。
本 lane 本轮复核：**W-1 已在真实链路** —— `src/components/MainToolbar.vue:37` 已 import `markRunInstanceStopping`、`:184` 已先记「请求停止」、`:389` 停止格已用 `row.stoppable` / `row.stopText` / `row.kill`（Kill process 档会出现）。W-2（native 归因列）/ W-3（注释订正）非本 lane。
