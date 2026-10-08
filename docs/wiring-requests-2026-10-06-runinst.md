# 接线请求 · 2026-10-06 · 运行实例族（代号 runinst）

派单：运行实例族（`exec/run-instances`）里用户还看得见的剩余缺项，**模块侧已做完**（纯函数/纯模型 + 判据），
本文件只放需要主代理/保留文件所有者接的线。每条都给「目标文件 + 目标行号 + import + 可照抄的整段替换」。

模块侧落点（已经在本仓、已经跑绿的那一份）：`src/runInstances.ts`
（行模型 `runInstanceRows`、停止装配 `stopActionState`/`stopChooserItems`/`resolveStopActionTargets`、
命名与描述 `runInstanceTabDescription`、复用判定 `chooseReuseInstance`、按实例解码 `decodeRunChunk`/`flushRunDecoder`）。
判据：`tests/run-instance-rows.test.mjs`（24 条）。

---

## R1 · src/bridge.ts：把 `instance` 传给解码入口（控制台内容按实例归属，**必须**）

**为什么要接**：上游一条 `RunContentDescriptor` 挂一个控制台（`platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt:308-312`），
每个实例的 stdout 是各自的管道；分块边界切开的半个字符只可能属于它自己那个实例。
本仓桥接层调用 `decodeRunChunk(data.dataB64)` 时没带 `data.instance`（`src/bridge.ts:357`），
所以两个实例并发输出时，甲的残段会被拼到乙的下一块前面 ⇒ **内容跑到别的标签里 + 解成乱码**。
模块侧已经支持第二参数（省略时保持今天的形状，不传也不会退化），差的就是这两个实参。

**目标文件**：`src/bridge.ts`（保留文件）
**目标行**：`353-362`（`case 'run.output'`）与 `363-370`（`case 'run.exit'`）

`353-362` 整段替换为：

```ts
    case 'run.output': {
      // Bytes, not text: a build prints in the console code page and a chunk boundary
      // can fall inside a multi-byte character, so decoding is streamed and flushed
      // when the last step of the run exits.
      // 解码必须**按实例**分（上游一条 descriptor 一个 ConsoleView：
      // platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt:308-312）：
      // 不带 id 的实例只能走全局解码器，两个实例交错时甲的残段会拼到乙的下一块前面。
      const instance = typeof data.instance === 'number' ? data.instance : undefined
      const text = typeof data.dataB64 === 'string' ? decodeRunChunk(data.dataB64, instance)
        : typeof data.chunk === 'string' ? data.chunk : null
      if (text === null) return false
      if (text) handleRunOutput(data.instance, text)
      return true
    }
```

`363-370` 整段替换为：

```ts
    case 'run.exit': {
      if (typeof data.code !== 'number') return false
      // A chained run ("Before launch" steps) emits one exit per step; the console
      // stays in the running state until the last step has reported.
      // 冲残段同样只冲**这条退出所属实例**的（模块里 `handleRunExit` 已经会带 id 兜底，
      // 这里先冲一次是为了保持「先补最后半个字、再写结束提示」的原有顺序）。
      const tail = flushRunDecoder(typeof data.instance === 'number' ? data.instance : undefined)
      if (tail) handleRunOutput(data.instance, tail)
      return handleRunExit(data)
    }
```

**import 不用改**：`src/bridge.ts:13` 已经在引 `decodeRunChunk` / `flushRunDecoder`。
**判据同步**：`tests/run-instance-rows.test.mjs` 里有一条锚点断言
`assert.match(bridge, /decodeRunChunk\(data\.dataB64\)/)` 与 `assert.match(bridge, /flushRunDecoder\(\)/)`，
它们钉的是**挂载前**的形状；接完 R1 请把这两条改成挂载后的形状（**只换形状、不许删断言**）：

```ts
  assert.match(bridge, /decodeRunChunk\(data\.dataB64, instance\)/)
  assert.match(bridge, /flushRunDecoder\(typeof data\.instance === 'number' \? data\.instance : undefined\)/)
```

---

## R2a · src/components/MainToolbar.vue：停止那一格读「多实例停止装配」模型

**为什么要接**：现在这一格是 `disabled = !runState.running && !dapState.running`，
文案永远是「停止 (Ctrl+F2)」，多条实例并存时用户看不出**停的是谁、一共有几个**。
上游 `StopAction` 在多条时会把文案写成「Stop…」并在图标上叠一个计数，一条时才写
`Stop ''<名字>''`，一条都没有时在新 UI 运行工具条那一格**整格不见**：
`platform/execution-impl/src/com/intellij/execution/actions/StopAction.java:73-128`
（计数文本 `platform/execution-impl/src/com/intellij/execution/ui/RunToolbarPopup.kt:752-758`，
文案键 `platform/execution/resources/messages/ExecutionBundle.properties:208`、`:209`）。
判定已经写在 `src/runInstances.ts`（`stopActionState` / `resolveStopActionTargets`），组件只读它。

**目标文件**：`src/components/MainToolbar.vue`
**目标行**：`36`（import 那行）与 `341`（停止按钮那一行）

`36` 替换为：

```ts
import { activeRunInstance, focusRunInstance, resolveStopActionTargets, runInstanceList, runInstanceRows, STOP_LABELS, stopActionState } from '../runInstances.ts'
```

`341` 替换为：

```html
        <!-- 上游 `StopAction.update():73-128`：一条都没有 ⇒ 这一格不可点（新 UI 工具条那一档整格不见）；
             恰好一条 ⇒ 文案「停止『名字』」；多条 ⇒ 「停止…」+ 图标上叠计数（>9 收成 9+）。
             判定与文案键都在 src/runInstances.ts 的 stopActionState 上，这里只读它。 -->
        <button
          v-if="stopUi.visible"
          class="header-widget stop-button"
          :class="{ killing: stopUi.kill, multi: stopUi.badge !== '' }"
          :title="stopUi.title" :aria-label="stopUi.title" :aria-description="stopUi.description"
          :disabled="!stopUi.enabled"
          @click="onStopClick"><Square :size="iconSize.control" aria-hidden="true" /><span v-if="stopUi.badge" class="stop-counter">{{ stopUi.badge }}</span></button>
```

`<script setup>` 里追加（放在已有的 `props`/`emit` 定义之后）：

```ts
// 「停止」那一格的多实例形态（上游 StopAction.java:73-128；判定是纯函数，测试见 tests/run-instance-rows.test.mjs）。
const stopRows = computed(() => runInstanceRows(activeRunInstance.value))
let stopPopupOpen = false
const stopUi = computed(() => {
  const state = stopActionState(stopRows.value, 'newUiRunToolbar', activeRunInstance.value)
  const shortcut = 'Ctrl+F2' // 与本仓 keymap 的 Stop 一致（src/keymap.ts 是保留文件，键位不在这里改）
  return {
    ...state,
    title: state.text === STOP_LABELS.base ? `${STOP_LABELS.base} (${shortcut})` : state.text,
    description: state.description,
  }
})
function onStopClick(): void {
  // 上游：只有一条时直接停（:141-143）；多条时弹选择器（:152-181）；弹层还开着再点一次 = 停全部并收起（:169-174）。
  const targets = resolveStopActionTargets(stopRows.value, stopPopupOpen)
  if (targets.popup) { stopPopupOpen = true; /* 见 R2c：弹层用 stopChooserItems(...) 的行数据 */ return }
  stopPopupOpen = false
  for (const id of targets.ids) void props.ctx.stopRunInstance(id)
}
```

> `props.ctx.stopRunInstance(id)` 是本仓 `runActions.ts` 已有的「停某一个实例」入口
> （`src/runActions.ts` 的 `stopRun` 走 `run.stop {instance}`）。若宿主 `ctx` 上只有 `stopAnyProcess`，
> 就先接 `stopRun`（它已经带实例 id），不要退回「停全部」。

**样式约束**：`.stop-counter` 只允许用现有令牌（`--dur-*`/`--ease`/`--icon-size-*`），不新加动效。

---

## R2b · src/components/RunConsole.vue：标签条与关闭按钮读行模型（含 pid 描述）

**为什么要接**：标签上的三格——选中、退出码、`×` 可不可用——现在是组件里各算各的
（`src/components/RunConsole.vue` 的 `title()` `:113-115`、`exitLabel()` `:118-121`、
模板 `:368-376`），而上游这三格都来自同一个 `RunContentDescriptor`
（`platform/execution/src/com/intellij/execution/ui/RunContentDescriptor.java:116-123`、`:218-220`；
标签描述 = `process.id.tooltip`，在
`platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt:369-376` 设、
`:389-405` 的具体 `:402` 清）。同名实例上游**不给标题加序号**（全树只有一处
`UniqueNameGenerator` 是给*配置名*去重用的：
`platform/execution-impl/src/com/intellij/execution/actions/EditRunConfigAndRunCurrentFileExecutorAction.java:46-47`），
区分手段就是那句 pid ⇒ 本仓必须把它搬到标签上，而不是再造一个 `#2`。

**目标文件**：`src/components/RunConsole.vue`
**目标行**：`61-65`（import 那块）、`113-121`（`title`/`exitLabel`）、`367-377`（标签条模板）

`61-65` 的 `from '../runInstances.ts'` 那组里补两个名字（其余不动）：

```ts
import {
  applyRunInstanceSnapshot, clearRunOutput, closeRunView, runConsoleEncoding,
  runInstanceDisplayName, runInstanceRows, runningListEnabled, runningListRows, RUNNING_LIST_LABELS,
  runOutputPaused, setInstanceCoverage, setRunConsoleEncoding, setRunOutputPaused,
  STOP_LABELS, type RunInstanceRecord, type RunInstanceRow,
} from '../runInstances.ts'
```

`113-121` 替换为（组件不再自己算名字/退出码）：

```ts
/** 标签行 = 行模型按标签条顺序投影（判定与上游坐标都在 src/runInstances.ts 的 runInstanceRows 上）。 */
const rowsById = computed(() => new Map(runInstanceRows(props.active).map(row => [row.id, row])))
function row(instance: RunInstanceRecord): RunInstanceRow | undefined {
  return rowsById.value.get(instance.id)
}
```

`367-377` 替换为：

```html
    <div v-if="instances.length > 1" class="run-tabs" role="tablist" aria-label="运行实例">
      <div v-for="instance in instances" :key="instance.id" class="run-tab" :class="{ selected: instance.id === active }">
        <button role="tab" :aria-selected="instance.id === active"
                :title="[row(instance)?.title ?? '', row(instance)?.tabDescription ?? ''].filter(Boolean).join(' — ')"
                @click="emit('select', instance.id)">
          <span v-if="!tabLabelsHidden" class="run-tab-title">{{ row(instance)?.title ?? '' }}</span>
          <RunningDot v-if="row(instance)?.live" />
          <span v-if="row(instance)?.exitText" class="run-tab-badge">{{ row(instance)?.exitText }}</span>
        </button>
        <!-- 关闭/停止那一格的可停性读 canBeStopped（StopAction.java:310-315）：正在结束途中仍要点得动，
             只是语义换成 Kill process（:106-110）。 -->
        <button v-if="row(instance)?.stoppable" class="run-tab-close"
                :aria-label="(row(instance)?.kill ? STOP_LABELS.kill : STOP_LABELS.base) + ' ' + (row(instance)?.title ?? '')"
                :title="(row(instance)?.kill ? STOP_LABELS.kill : STOP_LABELS.base) + ' ' + (row(instance)?.title ?? '')"
                @click="closeView(instance.id)"><X :size="iconSize.inline" /></button>
      </div>
    </div>
```

> **这是一处行为改变**（不只是搬家）：今天的 `×` 是 `v-if="instance.running"`，
> 于是「已发停止请求、还在结束途中」时那格消失，用户没法再点一次硬杀；
> 上游 `canBeStopped`（`StopAction.java:310-315`）在这种状态下仍然可点，图标换成 KillProcess（`:106-110`）。

---

## R2c · 多实例停止选择器（弹层本体）

`stopChooserItems(stoppableCandidates(runInstanceRows(active)), active, 'Ctrl+F2')` 已经给出
条目（新起在前 = `platform/execution-impl/src/com/intellij/execution/StoppableRunDescriptors.kt:19` 的
`asReversed()`；已结束的不进 = `:24-26`；末尾追加「停止全部（Ctrl+F2）」= `StopAction.java:158-168`、`:177-179`；
预选中当前视图 = `:213-215` + `:279-290`；标题两档 = `:199` 对应
`ExecutionBundle.properties:491`（多条）/`:492`（只有一项））。
挂哪儿由主代理定（本仓没有 Swing 弹层，`RunConsole.vue` 的「正在运行」清单或 `MainToolbar.vue` 的运行仪表盘
都是现成的宿主），**不要**为它新造一个没有消费者的面板。上游一条执行环境只出**一条代表**
（`StoppableRunDescriptors.kt:51-62`，靠 `DisplayDescriptorChooser` 扩展点，`:87-107`）——
本仓没有 EP 宿主，所以一个实例一行，这条差异请写进判词（见 R4）。

---

## R3 · 同名已结束那格的复用（`chooseReuseInstance`）

上游：新起一条时先在同一个 contentManager 里找「可复用」的旧格——条件是
**没钉住 + 进程已结束 + 不是同一次执行**（`RunContentManagerImpl.kt:854-856`），
名字匹配优先（`:810-813` + `:839-846`）、否则取第一个「好」的（`:848-851`）、选中的那格先查（`:834-838`）；
命中后**原地换内容**（`:298-308` 保留 content、把 component 换成新 descriptor 的），旧 descriptor 被 dispose。

本仓判定已经落成纯函数 `chooseReuseInstance(candidates, title, executionId, selectedId)` 并被测试钉住，
但**没有自动接上**，原因如实登记：本仓标签条是扁平的、按起跑顺序排，
「摘掉旧格 + 新格排到末尾」与上游的「原地替换」不是同一件事（位置/固定态都会跳）。
要接的话需要一并决定：① `RunInstanceRecord` 加 `pinned`（上游 `Content.isPinned`；
注意 `src/runToolWindowLayout.ts:29-32` 已经登记过「运行视图在上游永远不是固定的」那条差异）；
② 起跑链路（`src/runActions.ts` 的 `startRun` / `handleRunStarted`）在拿到宿主新 id 之前先问一次复用。
宿主侧注意：`native/run_host.cpp:363-365` 在 `allowParallel` 关闭时是**静默停掉同名实例**的，
上游在同样的情形下会先问用户（`platform/execution-impl/src/com/intellij/execution/impl/ExecutionManagerImpl.kt:617-619`、`:627`、`:630-637`，
确认框文案在 `ExecutionBundle.properties:212`（`rerun.singleton.confirmation.message`）、
标题 `:94`（`process.is.running.dialog.title`）、按钮 `:213`（`rerun.confirmation.button.text=Stop and Rerun`），
「不再显示」那一格在 `ExecutionManagerImpl.kt:1104-1118` + `platform/platform-api/resources/messages/UIBundle.properties:1`）。
⇒ **另一条待接的用户可见线**：非并行配置重跑时那几句问话（本仓现在是直接停，不问）。

---

## R4 · 判词升档（`scripts/verdict_table.py` 的 `exec/run-instances` 那一行，保留文件 ⇒ 请主代理改脚本）

`docs/inventory/verdict-execution.md` 是生成的，别手改；下面是建议追加到该族判词末尾的那一段
（每条都带本机参考树里的真实坐标）：

> 本轮（runinst 批）又补了实例列表的**行模型**：`src/runInstances.ts` 的 `runInstanceRows`
> 一次给出选中（`platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt:432-435`）、
> live/置灰（`:361-366`、`:401`）、退出码四档（与 `src/runDashboard.ts` 同一规则）、
> 标签描述那句 pid（`ExecutionBundle.properties:204`，设/清在 `RunContentManagerImpl.kt:369-376` 与 `:402`）、
> 每格的可停性（`StopAction.java:310-315`）与控制台缓冲占用（`ConsoleBuffer.java:8-22` +
> `ConsoleViewImpl.kt:186-187`）；多实例并存时「停止」的装配（一条直接停 / 多条「停止…」+ 计数 /
> 新 UI 那一档一条都没有时整格不见 / 末尾「停止全部」/ 预选中当前视图）落成
> `stopActionState`+`stopChooserItems`+`resolveStopActionTargets`（`StopAction.java:73-128`、`:141-179`、`:199`、
> `:213-215`、`:293-308`，顺序与过滤在 `StoppableRunDescriptors.kt:19`、`:24-26`，
> 计数文本在 `RunToolbarPopup.kt:752-758`）；控制台输出的**按实例归属**补了每实例一套流式解码器
> （`decodeRunChunk(b64, instance)`，桥接层传 id 的那一步见 docs/wiring-requests-2026-10-06-runinst.md R1）；
> 同名格的复用判定落成 `chooseReuseInstance`（`RunContentManagerImpl.kt:788-826`、`:828-856`）。
> 仍缺（用户可见）：① 停止选择器的弹层本体（判定齐了，宿主没地方挂，见 R2c）；
> ② 非并行配置重跑时的那句确认（上游 `ExecutionManagerImpl.kt:605-641` + `:1097-1128`，
> 本仓宿主 `native/run_host.cpp:363-365` 是静默停）；③ `DisplayDescriptorChooser` 那条
> 「一个执行环境只出一个代表」的归并（`StoppableRunDescriptors.kt:51-62`、`:87-107`，没有 EP 宿主）；
> ④ **按实例的进程内存占用**：上游没有这个用户可见面（`platform/execution-impl/src/com/intellij/execution/`
> 与 `platform/execution/src/com/intellij/execution/` 两目录 grep `memory` 只命中 JNA 的 `MemorySegment`
> 和 `createSmallMemoryFootprintSet`，`platform/execution.dashboard` 零命中）⇒ 判 `[-]`，
> 本仓行模型只带上游真有的控制台缓冲，不编工作集读数。

**坐标更正（原写 X、实际 Y，留痕）**：派单与本仓旧注释写的
`platform/execution/impl/src/com/intellij/execution/executor/ExecutionManagerImpl.java`
在这份树里**不存在**；实际是 `platform/execution-impl/src/com/intellij/execution/impl/ExecutionManagerImpl.kt`
（Kotlin，不在 `execution/impl` 也不在 `executor` 包）。
`RunContentManagerImpl` 同理：实际是 `platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt`
（不在 `platform/lang-impl`）。
另：`src/runInstances.ts` 与 `src/consoleEncoding.ts` 旧注释引的
`ConsoleViewImpl.setEncoding` 在这份树里**没有这个方法**（`platform/lang-impl/src/com/intellij/execution/impl/ConsoleViewImpl.kt`
grep `setEncoding` 零命中）；上游的「控制台编码」是**应用级默认**，在设置页：
`platform/lang-impl/src/com/intellij/execution/console/ConsoleEncodingComboBox.kt:20-57` +
同目录 `ConsoleConfigurable.java:116-125`、`:157-159`、`:183-190`。
`src/runInstances.ts` 里那处注释本轮已按上游改；`src/consoleEncoding.ts:5-7` 不在本族可改面里 ⇒ 请该文件的所有者同步。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1（`src/bridge.ts` instance 传给解码入口）** —— bridge 保留文件，非本 lane。
- **R2a / R2b（`MainToolbar.vue` / `RunConsole.vue` 读行模型）** —— 本 lane 可改面，登记为待办（属运行域 owner 的在途面）。

结论：零接线（R1 转 bridge owner，R2a/R2b 登记）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（R1 转 bridge owner，R2a/R2b 登记）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
