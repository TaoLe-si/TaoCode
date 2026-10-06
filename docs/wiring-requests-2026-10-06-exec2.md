# 接线请求 · 2026-10-06 · exec2（exec/ui 域：启动运行实例时的「打开面板 / 夺焦 / 新建标签」）

判定本体已经落地并被生产消费：`src/runStartupFocus.ts`（纯函数）+ `src/runActions.ts` 的 `startRun`
（`if (startup.activateToolWindow) showOutput('run')`，默认值 true ⇒ 与接线前逐字相同）。
下面四条是**只有主代理能接的线**（宿主面在保留文件里：`src/App.vue`、`src/settingsModel.ts`、
`src/bridge.ts`、`src/components/RunConsole.vue` 由别的 lane 在改）。每条给：目标文件 + 目标行号 +
import 语句 + 可照抄的整段替换代码 + 上游依据。

---

## R1 · `Runner.FocusOnStartup` 那条**判词要订正**（留痕：原写 X、实际 Y）

| # | 原写（别人/派单的坐标或结论） | 实际（逐条打开过） |
|---|---|---|
| 1 | 派单：`platform/execution/impl/src/com/intellij/execution/ui/RunContentManager.java` | 参考树里没有 `platform/execution/impl/` 目录。接口 = `platform/execution/src/com/intellij/execution/ui/RunContentManager.java:23`（`showRunContent` 声明 `:64-66`、`getReuseContent` `:58-59`）；实现 = `platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt:70` |
| 2 | 派单：`ExecutionUtil` 里有这条判定 | `platform/execution/src/com/intellij/execution/runners/ExecutionUtil.java`（322 行）全文 `focus`/`activat` 只命中 `:167` 的超链接事件 ⇒ **与本案无关** |
| 3 | 派单：`RunnerSettings` 带这个开关 | `platform/execution/src/com/intellij/execution/configurations/RunnerSettings.java:20` 整份文件是 `public interface RunnerSettings extends JDOMExternalizable {}`，**零字段** |
| 4 | 派单：`BeforeRunTaskDescriptor` | 参考树里**没有这个类**（按文件名只得到 `platform/execution/src/com/intellij/execution/BeforeRunTask.java`、`BeforeRunTaskProvider.java`、`platform/execution-impl/src/com/intellij/execution/impl/BeforeRunTaskAwareConfiguration.java`、`BeforeRunTaskHelper.kt`）。这两个开关住在 `RunnerAndConfigurationSettingsImpl`（坐标见 R2） |
| 5 | 派单：`platform/execution/ex-ui-resources/.../ui/Bundle.properties` | 该目录不存在。文案真身 `platform/execution/resources/messages/ExecutionBundle.properties:175-176`（「Open run/debug tool window when started」/「Focus run/debug tool window when started」）与 `:347-348`（「Activate tool window」/「Focus tool window」） |
| 6 | `docs/batch-2026-10-06-bucket10b.md:79` 与 `:161`：`Runner.FocusOnStartup` 的**方向** | `platform/lang-api/src/com/intellij/execution/ui/actions/AbstractFocusOnAction.java:20-26` 原文 `final boolean visible = content.length == 1;` ⇒ **恰好选中一个视图时才显示**。（`src/runToolWindowLayout.ts` 旧文本写成「`content.length == 1` 时整条不显示」，本轮已当场订正并留痕；`tests/runner-view-actions.test.mjs` 的三条既有断言一字未改、仍绿。） |
| 7 | `docs/batch-2026-10-06-bucket10b.md:161` 的结论「所以整件做不了」 | 只对**布局格那半件**成立。上游 `RunnerLayout.java:292-296` 的 `General.focusOnCondition` 是**空 map** ⇒ 那条 id 默认就没有任何东西夺焦（消费点 `RunnerContentUi.java:1813-1833` → `:1858-1866` → `:1880-1889` 第一行 `if (contentId == null) return;`）。用户感知的「启动时把焦点移到运行面板」是运行配置的两个开关，与本条 id 无关 ⇒ 已实现，见 R2/R3 |

⇒ 请主代理把这三行订正抄进判词真源（`docs/inventory/verdict-platform_rest.md` 是保留文件，我没动）：
`Runner.FocusOnStartup` = `[~]` 部分（**布局格那半件不渲染**，`src/runToolWindowLayout.ts` 的
`RUNNER_VIEW_ACTIONS_NOT_PORTED`；**用户可见那半件已做**，`src/runStartupFocus.ts` + `src/runActions.ts`），
不要再登记成 `[ ]` 整条未做或 `[-]` 不适用。

---

## R2 · 设置页两格（`src/settingsModel.ts`，主代理独占）

上游两格文案 = `ExecutionBundle.properties:175-176`。本仓界面中文 ⇒ 直译（本地化包不在本地树）：
「启动时打开运行/调试工具窗口」/「启动时把焦点移到运行/调试工具窗口」。
默认值必须照 `platform/execution-impl/src/com/intellij/execution/impl/RunnerAndConfigurationSettingsImpl.kt:108-109`
= `true` / `false`；读档缺键的补法照同文件 `:242-244`（缺 activate 按 **true**：`value == null || value.toBoolean()`）。

```ts
// src/settingsModel.ts —— GeneralSettingsState 里加两键（键名与 src/runStartupFocus.ts 的存档形状一致）
  /** 上游 `isActivateToolWindowBeforeRun`（RunnerAndConfigurationSettingsImpl.kt:108，默认 true）。 */
  runActivateToolWindow: boolean
  /** 上游 `isFocusToolWindowBeforeRun`（同文件 :109，默认 false）—— 判词里那条「启动时聚焦」。 */
  runFocusToolWindow: boolean
```
旧存档缺键 ⇒ 用 `resolveRunStartupFocusFlags()`（`src/runStartupFocus.ts`）补上游默认，
**不许按字段数量判损坏**（本仓出过把用户锁在项目外的事故）。

---

## R3 · `takeFocus` 的宿主动作（`src/App.vue`，本轮只有 `appvue` 能改）

现在 `startRun` 只会「打开面板」（`runActions.ts` 的 `if (startup.activateToolWindow) showOutput('run')`）；
**把键盘焦点移进面板**这一步需要 App.vue 的 `focusToolWindowContent`（`src/App.vue:336`）。

```ts
// src/App.vue —— 放在 focusToolWindowContent（:336）之后、runTabs（:639-640）附近
import { decideRunStartupFocus, readRunStartupFocus } from './runStartupFocus.ts'
import { runInstanceList, activeRunInstance } from './runInstances.ts'

// 启动一个运行实例后，按上游那三个开关决定「打开 / 切选中 / 夺焦」。
// 上游链路：ExecutionManagerImpl.kt:290-293 → RunContentManagerImpl.kt:432-435 / :439-441 / :450-458。
function applyRunStartupFocus() {
  const live = runInstanceList().find(row => row.running)
  const startup = decideRunStartupFocus({
    ...readRunStartupFocus(),
    existingView: live ? { running: live.running, selected: live.id === activeRunInstance.value } : null,
    // RunContentManagerImpl.kt:451-457 —— 焦点原本在被换掉的那块视图里（本仓等价：没有活动元素）。
    focusOwnerMissing: typeof document === 'undefined' || document.activeElement === document.body,
  })
  if (startup.takeFocus) focusToolWindowContent('run')
}
```
调用时机 = `run.started` 事件把新实例选中之后（`src/runInstances.ts:183` 那句 `focusRunInstance` 之后）。
不接也不影响 R4 的默认行为；不接的后果是「设置开了也不夺焦」（面板仍会打开）。

---

## R4 · `selectView` / `createNewTab` 的标签动作（`src/runInstances.ts` + 宿主）

`src/runInstances.ts:183` 现在无条件 `focusRunInstance(data.instance)`（注释写「IDEA 打开新 Content 时会选中它」）。
上游这条是 `RunContentDescriptor.java:52` 的 `isSelectContentWhenAdded`（默认 true），
并且 `RunContentManagerImpl.kt:432-435` 还有半个条件「复用来的那一格本来就选中 ⇒ 也要再选一次」。
默认值 true ⇒ 现状与上游一致，**不需要改**；只有当设置页要给「不自动切标签」留口子时才按
`decideRunStartupFocus(...).selectView` 加闸。`createNewTab` 恒为真：本仓每个实例由宿主给新 id
（`native/run_host.cpp` 的并行实例），上游那套「已结束标签的复用」（`RunContentManagerImpl.kt:814`、
`:854-856`）在本仓**没有对应物** ⇒ 前端不要假装能复用。

---

## R5 · 文案与键位没有新增，故无 `actionRegistry.ts` / `keymap.ts` 请求

本轮没有新增动作、没有新增控件（不放假控件）：设置页那两格（R2）在宿主接了 R3 之后才有意义，
在那之前**不渲染**（沿用本仓「没有消费链路就不出现」的规矩）。
