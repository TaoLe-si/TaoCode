// 断点「富编辑」面板的纯规则 —— 上游 `XLightBreakpointPropertiesPanel` + `BreakpointEditor`
// （IDEA 点装订线上的断点弹出的那一页，也是「查看断点…」右侧详情的那套字段）。
//
// 上游坐标（逐条对上；文案取 `platform/xdebugger-api/resources/messages/XDebuggerBundle.properties`）：
//   · `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/breakpoints/ui/XLightBreakpointPropertiesPanel.java:66`
//     —— `CONDITION_HISTORY_ID = "breakpointCondition"`（条件输入框的历史槽名）；
//   · 同文件 `:327-332` —— 「Condition:」复选框 + 表达式编辑器（`xbreakpoints.condition.checkbox`，
//     properties `:90`）；`:415` —— Enabled 复选框直接 `breakpoint.setEnabled(...)`
//     （`xbreakpoints.enabled.label`，properties `:91`）；
//   · 同文件 `:559-565` —— 保存：`XExpression condition = isEmptyExpression(e) ? null : e;`
//     `setConditionEnabled(condition == null || checkbox.isSelected())` ⇒ **条件为空时启用位强制为真**；
//   · 同文件 `:307-313` —— DEPENDENCY 面板（`XMasterBreakpointPanel`）：上游是个「选别的断点」的组合框，
//     本仓同样给断点清单（数据 = `dapBreakpoints`），不再让用户手写 `文件:行`；
//   · 同文件 `:298-305` —— SUSPEND_POLICY 面板：DAP 的 `Source.Breakpoint` 没有挂起策略字段
//     （`src/bridge.ts:236` 只有 line/condition/hitCondition/verified，native 另透传 logMessage，
//     见 `native/dap_shaping.cpp:323`）⇒ **本仓不画这一格**（画了就是点不动的假控件）；
//   · `.../ui/XBreakpointActionsPanel.java:39` `LOG_EXPRESSION_HISTORY_ID = "breakpointLogExpression"`；
//     `:120`/`:128`/`:234` 三个文案 = `xbreakpoints.log.message.label=Log:`（properties `:86`）、
//     `"Breakpoint hit" message`（`:87`）、`&Evaluate and log:`（`:89`）——
//     DAP 的 `logMessage` 一条字段就同时是「静态消息」和「带 `{表达式}` 的模板」，
//     所以本仓把两档合成一个输入框，差异记在这里；
//   · `:134` `xbreakpoints.log.stack.checkbox=Stack trace` —— DAP 没有「命中时打栈」的字段 ⇒ 不画；
//   · `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/BreakpointEditor.java:151-153`
//     —— Esc / Enter / Ctrl+Enter 三个键都走 `done()`；`:98-99` Done 按钮
//     （`done.action.text=Done`，properties `:224`）；`:65-77` 「More」链接（`xbreakpoints.popup.more.label=More`，
//     properties `:225`）后面跟着 `View Breakpoints` 的快捷键文案。
//
// 本仓的落点：`src/components/DebugBreakpointEditDialog.vue`（挂在断点区
// `src/components/DebugBreakpointsPane.vue` 的每条断点上）。

import type { DapBreakpoint } from './bridge.ts'

/** 上游 `XLightBreakpointPropertiesPanel.CONDITION_HISTORY_ID`（`:66`）。 */
export const CONDITION_HISTORY_ID = 'breakpointCondition'
/** 上游 `XBreakpointActionsPanel.LOG_EXPRESSION_HISTORY_ID`（`:39`）。 */
export const LOG_EXPRESSION_HISTORY_ID = 'breakpointLogExpression'

/** 面板上一次编辑的全部字段（顺序照上游：Enabled → Condition(+启用位) → Hit → Log → 临时/依赖/组）。 */
export interface BreakpointEditModel {
  /** 断点启用（上游树上复选框 / `setEnabled`，`XLightBreakpointPropertiesPanel.java:415`）。 */
  enabled: boolean
  /** 「Condition:」那个复选框（`:327`/`:562`）。关掉 ⇒ 文本留着、这次不发条件。 */
  conditionEnabled: boolean
  condition: string
  hitCondition: string
  logMessage: string
  /** 临时断点（命中一次自删，`ToggleTemporaryLineBreakpointAction`）。 */
  temporary: boolean
  /** 依赖断点的 ref（`path:line`）；空串 = 无依赖。 */
  dependency: string
  /** 用户组名；null = 无组。 */
  group: string | null
}

/** 一条断点在编辑器里看到的当前状态（`enabled`/`temporary`/`dependency`/`group` 都是本仓侧状态）。 */
export function breakpointEditModel(input: {
  point: DapBreakpoint & { logMessage?: string }
  enabled: boolean
  conditionEnabled: boolean
  temporary: boolean
  dependency?: string
  group?: string | null
}): BreakpointEditModel {
  return {
    enabled: input.enabled,
    conditionEnabled: input.conditionEnabled,
    condition: input.point.condition ?? '',
    hitCondition: input.point.hitCondition ?? '',
    logMessage: input.point.logMessage ?? '',
    temporary: input.temporary,
    dependency: input.dependency ?? '',
    group: input.group ?? null,
  }
}

/** 上游 `DebuggerUIUtil.isEmptyExpression`：只有空白就算空表达式。 */
export function isEmptyExpression(text: string | undefined): boolean {
  return !text || !text.trim()
}

/**
 * 「条件启用位」的落法（上游 `:561-562`）：条件是空表达式 ⇒ 启用位为真（没条件谈不上开/关）；
 * 有条件 ⇒ 用复选框的值。返回的是**要存的**启用位，不是要发的条件。
 */
export function conditionEnabledFor(condition: string, checkbox: boolean): boolean {
  return isEmptyExpression(condition) ? true : checkbox
}

/** 这一次发给适配器的三个字段（上游 `setConditionExpression` + DAP 的 hitCondition/logMessage）。
 *  空串一律删键（DAP 里缺字段 = 没有该属性）；条件关掉 ⇒ 不发条件，但文本留在本仓的断点上。 */
export function breakpointEditPatch(model: BreakpointEditModel): {
  condition?: string; hitCondition?: string; logMessage?: string
} {
  const next: { condition?: string; hitCondition?: string; logMessage?: string } = {}
  const condition = model.condition.trim()
  if (condition && model.conditionEnabled) next.condition = condition
  const hit = model.hitCondition.trim()
  if (hit) next.hitCondition = hit
  const log = model.logMessage.trim()
  if (log) next.logMessage = log
  return next
}

/** 条件被「关掉」的断点（文本留着、这次不发）。 */
export function isConditionDisabled(model: BreakpointEditModel): boolean {
  return !isEmptyExpression(model.condition) && !model.conditionEnabled
}

/** 与初始状态比有没有改动（上游没这条，但本仓要据此决定要不要发 `setBreakpoints`）。 */
export function breakpointEditChanged(before: BreakpointEditModel, after: BreakpointEditModel): boolean {
  return JSON.stringify(before) !== JSON.stringify(after)
}

/**
 * 键盘模型（`BreakpointEditor.java:151-153`：ESCAPE / ENTER / Ctrl+Enter 都注册到 `done()`）。
 * 本仓的 `done` 在「从输入框里按 Enter」时是**提交**，Esc 是**放弃** —— 与上游那个「面板内容即时
 * 写回断点、Done 只收窗」的形态同一后果（上游 `saveProperties` 在关闭时统一落盘，`:545-568`）。
 */
export function breakpointEditKey(key: string, ctrl: boolean, shift: boolean, alt: boolean, multiline: boolean): 'commit' | 'cancel' | 'none' {
  if (key === 'Escape') return 'cancel'
  if (key === 'Enter' && ctrl) return 'commit'
  // 多行框里裸 Enter 是换行；单行框里裸 Enter 提交（上游那个整页快捷键是「焦点不在选区里」才生效）。
  if (key === 'Enter' && !shift && !alt && !multiline) return 'commit'
  return 'none'
}

/** 「More」链接的文案（上游 `xbreakpoints.popup.more.label=More`，properties `:225`）。 */
export const MORE_OPTIONS_LABEL = '更多选项'
/** Done 按钮文案（`done.action.text=Done`，properties `:224`）。 */
export const DONE_LABEL = '完成'
/** 「查看断点…」的快捷键文案在本仓的口径（`BreakpointsDialog` 的入口键；上游把键位拼在 More 后面，`:67-72`）。 */
export const VIEW_BREAKPOINTS_SHORTCUT = 'Ctrl+Shift+F8'

/**
 * 依赖选择器的候选：全仓所有断点的 ref（上游 `XMasterBreakpointPanel` 给的就是那份清单）。
 * 排除自己（`XBreakpointDependency` 不能自依赖）。
 */
export function dependencyOptions(refs: readonly string[], self: string): string[] {
  return refs.filter(ref => ref && ref !== self)
}

/** 组候选（上游「移至组」子菜单 = distinct + 按码元序，`BreakpointsDialog.java:326-335`）。 */
export function groupOptions(names: readonly string[]): string[] {
  return [...new Set(names.filter(name => Boolean(name)))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}
