// 「查看断点…」对话框的**宿主登记表** —— 上游 `XDebuggerBreakpointsHandler` /
// `ToggleBreakpointsDialogAction` 在本仓的落点：对话框组件是 `src/components/BreakpointsDialog.vue`
// （本桶名下），但它的挂载点与打开状态在 `src/App.vue`（保留文件）里的
// `breakpointsOpen` / `openBreakpoints`（`src/runConfigurations.ts:194`，App 从那份 composable 里
// 解构出来，`src/App.vue:2565` 渲染 `<BreakpointsDialog v-if="breakpointsOpen" …>`）。
//
// 于是断点富编辑框里那条「更多选项 / 查看断点…」（上游 `BreakpointEditor.java:65-77` 的 More 链接）
// 没有可达的调用路径：组件树是 DebugBreakpointsPane → DebugPanel → ToolWindowView（后两个都不是
// 本桶名下）⇒ 逐层加 emit 要动别人的文件。这里用本仓既有的「宿主登记表」写法
// （同 `src/manageRecentsHost.ts` / `src/chooseTargetHost.ts` 那一族）把这条通道压成一行接线：
// App.vue 注册 `setBreakpointsDialogOpener(openBreakpoints)`，本模块负责「有没有」与「打开」。
//
// 假控件禁令落在这里：没注册之前 `breakpointsDialogAvailable` 是 false，
// 编辑框那条 More 链接**不渲染**（画出来就是一条点不动的链接）。
import { computed, ref, type ComputedRef } from 'vue'

let opener: (() => void) | null = null
const generation = ref(0)

/** 注册/撤销「查看断点…」的打开动作（App.vue 在 setup 里调一次，卸载时传 null）。 */
export function setBreakpointsDialogOpener(fn: (() => void) | null): void {
  opener = typeof fn === 'function' ? fn : null
  generation.value++
}

/** 现在点得动吗？（响应式：App.vue 晚一点注册也会立刻反映到模板上。） */
export const breakpointsDialogAvailable: ComputedRef<boolean> = computed(() => {
  void generation.value
  return opener !== null
})

/**
 * 请求打开对话框。返回是否真的有人接：调用方（`DebugBreakpointsPane.openBreakpointsDialog`）
 * 据此把「没接」写进断点区自己那行错误位，而不是静默无事发生。
 */
export function requestBreakpointsDialog(): boolean {
  if (!opener) return false
  opener()
  return true
}
