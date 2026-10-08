# 接线请求 · 2026-10-06 · 代号 **execui2**

派单：`exec/run-instances` 一族剩余的用户可见缺项。模块侧**能落手的那一条已经落地并跑绿**
（判据 `tests/run-rerun-confirm.test.mjs` 10/10，见 `docs/batch-2026-10-06-execui2.md` §2.2、§3.5）。
本文件只放**我落不了手**的线：每条都给「目标文件 + 实读行号 + 为什么不能我做 + 可照抄的那一段」。

上游树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下列坐标本批逐条 `sed -n` 打开核过）。

---

## W1 · 「以后不再显示此对话框」那一格（本批实现的那条确认缺的半边）

**为什么轮不到我**：`window.confirm` 只有「确定/取消」两个答案，画不出第三个勾选；
要画就得新增一个带复选框的模态组件 **并且**在 `src/App.vue` 挂它 ⇒ `src/App.vue` 是保留文件（只读），硬约束不许落手。
⇒ 本批刻意**没有**新增任何持久化键（没有生产写入方的存储就是死存储，正是 execui 刚拆掉的那种形状，
判据 `tests/run-rerun-confirm.test.mjs` 里「不许给这条闸配一份没有写入方的存储」那条钉着）。

**上游那一格**：`platform/execution-impl/src/com/intellij/execution/impl/ExecutionManagerImpl.kt:1104-1118`
的 `DoNotAskOption`（`isToBeShown`/`setToBeShown`/`canBeHidden()=true`/`shouldSaveOptionsOnCancel()=false`），
勾选文案 `platform/platform-api/resources/messages/UIBundle.properties:1`
`dialog.options.do.not.show=Do not show this dialog in the future`。
它落的是**应用级** advanced setting：键 `confirm.rerun.with.termination`
（登记 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1477`，`default="true"`；
读 `platform/execution-impl/src/com/intellij/execution/RunManagerConfig.java:51-53`）。
⇒ **不是**每条配置的设置，别塞进 `RunConfigurationsDialog.vue`（那会造出第二个真源）。

**本仓现成的零件**（不用新写模型）：
`src/messageDialog.ts:58-74` `messageDialogModel({…, doNotAsk, saveDoNotAskOnCancel})` 与
`:81-85` `shouldRememberChoice(model, selected, exit)`（取消关掉默认不记，与上游
`shouldSaveOptionsOnCancel()=false` 同档）；有样无组件的是
`src/components/TrustedProjectDialog.vue:101`（`<label v-if="model.doNotAsk" class="checkbox-row">…`）。

**要接的两步**：
1. 新增一个消息框组件（照抄 `TrustedProjectDialog.vue` 的壳），模型由
   `src/runRerunConfirm.ts` 给出的那三句组：
   ```ts
   messageDialogModel({
     type: 'question',
     title: RERUN_CONFIRM_LABELS.title(name),
     message: RERUN_CONFIRM_LABELS.message(name, count),
     buttons: messageButtons(['ok', 'cancel'], { ok: RERUN_CONFIRM_LABELS.stopAndRerun, cancel: RERUN_CONFIRM_LABELS.cancel }),
     doNotAsk: RERUN_CONFIRM_LABELS.doNotAsk,
   })
   ```
   （`RERUN_CONFIRM_LABELS` 已经在 `src/runRerunConfirm.ts:69-82`，四句都是上游原文直译，别改措辞。）
2. `src/App.vue` 挂它，并把 `shouldRememberChoice` 的结果写进那条应用级开关（**逐键补默认**：缺省 = `true`），
   然后把值传进 `needsRerunConfirmation({…, confirmationEnabled})` —— 这个入参本批已经留好（
   `src/runRerunConfirm.ts:133-134`），接上时生产路径不用改判定，只改实参。

**同步判据**：接完之后，`tests/run-rerun-confirm.test.mjs` 里「不许给这条闸配一份没有写入方的存储」那条
要从「不许出现存储」改成「出现的那一个键必须有生产写入方」——**同精度重写，不许删断言**。

---

## W2 · 多实例停止选择器的**弹层本体**（上一批 §R2c 的续）

**为什么轮不到我**：判定侧全齐（`src/runInstances.ts:810-819` `stopChooserItems`、`:716-720` `stoppableCandidates`、
`:827-836` `resolveStopActionTargets`），缺的只是挂载宿主。唯二现成宿主是
`src/components/RunConsole.vue` 与 `src/components/MainToolbar.vue` —— **两份都在我开工时的 `git status --porcelain` M 列表里**，
属于别在途车道（RunConsole 那份 M 差异就是上一批 §R2b 的落地），按硬约束「已在 M 列表且不属于我 ⇒ 写接线请求」处理。

**上游**：`platform/execution-impl/src/com/intellij/execution/actions/StopAction.java:152-181`（多条时弹选择器）、
`:158-168` 与 `:177-179`（末尾追加 `Stop All ({0})`，`{0}` = `KeymapUtil.getFirstKeyboardShortcutText("Stop")`，`:159`）、
`:199`（标题两档）、`:213-215` + `:279-290`（预选中最近打开的那格）；
顺序与过滤 `platform/execution-impl/src/com/intellij/execution/StoppableRunDescriptors.kt:19`（`asReversed()` 新起在前）、`:24-26`（已结束不进）。
文案键 `platform/execution/resources/messages/ExecutionBundle.properties:209`（`Stop All ({0})`）、
`:491`（`stop.process`）、`:492`（`confirm.process.stop`）。

**照抄件**见 `docs/wiring-requests-2026-10-06-runinst.md` §R2c（本批复核过它引的坐标仍然对得上）；
**不要**为它新造一个没有消费者的面板，也不要一次画两颗弹层。

---

## W3 · 提权运行（族判词第 ③ 条，判词说「本批冻结没有入口」——现在仍然冻结）

**为什么轮不到我**：要 `run.start` 多带一个提权参数并让宿主走 UAC 启动 ⇒ 同时碰
`src/bridge.ts`（`RunStartParams` 的 union，保留文件）与 `native/`（全目录归别人）。

族判词：`docs/inventory/verdict-execution-debug.md:28` 的「③ 提权运行（`execution/process/elevation`）：仍缺」。
上游一族在 `platform/execution/process/elevation/**`。
**这一条我连上游实现都没展开**——因为没有本仓入口可接，展开也只是抄一段跑不起来的代码；
登记为「无法在本车道核实其用户可见面」，不编造。

---

## W4 · 判词订正（`scripts/verdict_table.py` 的族表 ⇒ 保留文件，请主代理改）

本批「先核后做」时撞到的**三条与地面不符**的判词/坐标。逐条给证据，措辞请直接补进
`docs/inventory/verdict-execution-debug.md` 的 `exec/run-instances` 那一行（该文件是生成的，别手改）。

1. **族判词第 ⑤ 条「没有 JAR 运行表单」已经过时**。
   证据：`native/settings_schema.cpp:1010-1013` 的类型白名单已含 `"jar"`（`shell/application/debug/compound/jar` 五档），
   `src/jarRun.ts` 与 `tests/jar-run.test.mjs` 在位，`src/runActions.ts:106-115` 已把 JAR 折成 `java -jar <路径>` 的 argv。
   真缺的只剩**远程那一半**（`RemoteRunProfile`）。⇒ 建议改成「有 JAR 运行形态（`src/jarRun.ts` + 类型 `jar`），
   没有 `RemoteRunProfile` 这类远程配置」。

2. **`RunContentDescriptorReusePolicy`（`execution_verdict_table.md:791`，族 `exec/ui`，判 `[~]`「从未出现」）不是缺项**。
   上游那份文件（`platform/execution/src/com/intellij/execution/ui/RunContentDescriptorReusePolicy.java:9-22`）
   只有一个抽象方法 `canBeReusedBy`，`DEFAULT` 恒 `true`（`:11-16`）⇒ 它是
   `RunContentDescriptor.isContentReuseProhibited()` 的载体，本仓已把那条条件写进
   `src/runStartupFocus.ts:167-169`（`canReuseView`）与 `src/runInstances.ts:849-868`（`chooseReuseInstance`）。
   ⇒ 建议按「语义已由 X 承接」标注，别让下一车道把它当缺口重新实现一遍。

3. **派单/旧注释的 `RunContentManagerImpl.kt` 路径写错了包**：不是 `platform/execution-impl/src/com/intellij/execution/**impl**/`，
   是 `platform/execution-impl/src/com/intellij/execution/**ui**/RunContentManagerImpl.kt`（`find` 全树只出一个结果）。
   `ExecutionManagerImpl` 同理：`platform/execution-impl/src/com/intellij/execution/impl/ExecutionManagerImpl.kt`（Kotlin，不在 `executor` 包）。
   ⇒ 与 `docs/wiring-requests-2026-10-06-runinst.md:264-269` 是同一条订正，本批独立复核后确认它写对了。

**本批给族判词的增量**（建议追加到 `exec/run-instances` 那一行末尾）：

> 本轮（execui2）补了**非并行配置重跑的那道确认闸**：`src/runRerunConfirm.ts`
> （`needsRerunConfirmation`/`runningSameConfigIds`/`rerunConfirmationQuestion`，
> 上游 `platform/execution-impl/src/com/intellij/execution/impl/ExecutionManagerImpl.kt:605-646`、
> `:617-618`、`:627-631`、`:635-637`、`:949-959`、`:962-973`、`:1097-1128`，
> 默认档 `platform/execution/src/com/intellij/execution/configurations/RunConfiguration.java:194-195` 的 `ASK_AND_RESTART`，
> 开关默认 true 在 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1477`，
> 文案 `platform/execution/resources/messages/ExecutionBundle.properties:94`/`:212`/`:213`、
> `platform/ide-core/resources/messages/CommonBundle.properties:3`），
> 消费点 `src/runActions.ts:219-222`（排在 `saveAll()` 之前，答「取消」当场 `return null`、连面板都不碰）；
> 判据 `tests/run-rerun-confirm.test.mjs`。
> 仍缺（用户可见）：① 那个「以后不再显示」勾选（`window.confirm` 画不出来，且它落应用级开关、不是每条配置的设置
> ⇒ 见 docs/wiring-requests-2026-10-06-execui2.md W1）；② `CompatibilityAwareRunProfile` 那半边恒空
> （`ExecutionManagerImpl.kt:949-959` 要插件钩子，本仓没有 EP 宿主）⇒ 这道闸只有「同名在跑」一条来源；
> ③ `restartSingleton()` 的三档没有每类型配置可分派，恒上游默认档。
> 另：本批订正 `src/consoleEncoding.ts` 那处假坐标（上游**没有** `ConsoleViewImpl.setEncoding`，
> 三处 grep 零命中；真身是设置页的应用级默认 `ConsoleConfigurable.java:116-125`/`:157-160`/`:183-190`
> → `EncodingManagerImpl.java:360`），钉子 `tests/console-input.test.mjs`「订正钉子」那条。

---

## W5 · 一条**不属于本批**的红（在我必跑的 glob 里，请对应车道收尾）

```
$ node --test tests/run-*.test.mjs            # tests 169 / pass 168 / fail 1
not ok 33 - 执行侧收得下执行上下文的目录（run.start 的 cwd 不再写死工作区根）
```

**归因（可复算，不是我猜的）**：
```
$ git show HEAD:src/runActions.ts | grep -n "async function runExternalTool"
462:… runExternalTool(command: string, name: string, cwd?: string) {
$ grep -n "async function runExternalTool" src/runActions.ts
491:… runExternalTool(command: string, name: string, cwd?: string | null) {
$ git diff src/runActions.ts        # 这一处在本批开工前就已存在的 M 差异里，不是 execui2 写的
```
配的是 `src/runAnythingContext.ts`、`tests/run-anything-context-dialog.test.mjs`（都在 M 列表）⇒ **执行上下文那条车道**在途。

**一行改法**（同精度重写，别删断言），`tests/run-anything.test.mjs:102`：
```ts
  assert.match(source, /async function runExternalTool\(command: string, name: string, cwd\?: string \| null\)/,
    '外部工具那条通道要能接调用方给的目录')
```
我没去改它：源改动不是我的 ⇒ 配对的锚点重写也不是我的，同时改就是撞车。

---

## W6 · 一次**已经自愈的门禁抖动**（记下来，因为它会影响任何"全门禁绿"的结论）

本批收尾时 `find-orphan-modules --gate` 在几分钟内红了又绿，全过程如下（三条命令都留了原始输出）：

```
$ node .tools/find-orphan-modules.mjs --gate        # 第一次（本批刚落地）
  已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2  →  门禁绿，exit=0
$ node .tools/find-orphan-modules.mjs --gate        # 收尾复跑
  已登记孤儿 6 / 基线 8 · 新增 1 · 本轮清掉 2  →  门禁红，exit=1
     ✘ 新增零生产消费方模块：src/vcsLogDisplay.ts
$ node .tools/find-orphan-modules.mjs --gate        # 写下这条请求之前复核实情
  已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2  →  门禁绿，exit=0
```

**归因与结局**：那条红是 **VCS-log 那条车道**在途的新文件 `src/vcsLogDisplay.ts`
（未跟踪，同组 `src/components/VcsLog.vue`、`VcsLogTable.vue`、`src/vcsLogGraph.ts`、`src/vcsLogPresentation.ts` 全在 M 列表）。
我查证时它已经接上了：
```
$ grep -rn "vcsLogDisplay" --include=*.ts --include=*.vue src | grep -v "^src/vcsLogDisplay.ts"
src/components/VcsLogTable.vue:11:import { prettyLogDate } from '../vcsLogDisplay'
```
⇒ **不是我的文件、也没要我动手、现在已绿**。这条只留两个结论：

1. **本批的模块核过不是孤儿**：`grep -c "runRerunConfirm" <孤儿输出>` → 0，生产消费方在
   `src/runActions.ts:37`（`import { needsRerunConfirmation, rerunConfirmationQuestion, runningSameConfigIds } from './runRerunConfirm.ts'`）。
2. **给主代理的收门口径**：8 条以上车道并发时，`--gate` 的绿/红是**时刻敏感**的，
   任何一条"全门禁绿"都必须在收门那一刻重跑才算数——本批那条红从出现到消失只隔了几分钟，
   如果我在红的当口写"门禁绿"就是假报告。同理 `vue-tsc` 的红名单也在动（见 `docs/batch-2026-10-06-execui2.md` §3.3 的三轮原始输出）。


## 处理结果（wiring-backlog lane，2026-10-06）

- **W1（「以后不再显示」勾选框）未落** —— 需新增消息框组件（本 lane 可建）+ App.vue 挂载 + 应用级键（`settingsModel.ts` 保留文件）。因应用级键非本 lane，且请求原文要求「同步判据同精度重写」，未单方面落。
- **W2（多实例停止选择器弹层）** —— 目标 `src/components/RunConsole.vue` / `MainToolbar.vue`（请求原文点名在别在途车道）。跳过。
- **W3（提权运行）** —— 与 bucket10b 第 6 条同判，不落（缺传输层）。
- **W4（判词订正）** —— `scripts/verdict_table.py`，非本 lane。
- **W5 / W6** —— 登记项。

结论：零接线（W1 卡在 settingsModel + 新组件，W2 在别人组件里）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（W1 卡在 settingsModel + 新组件，W2 在别人组件里）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
