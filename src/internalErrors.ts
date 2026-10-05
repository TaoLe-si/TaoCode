// 「内部错误」指示器 —— 上游 `FatalErrorWidgetFactory`（显示名 `status.bar.fatal.error.widget.name`
// = 中文包「内部错误」）那个组件在本仓的等价物。
//
// 上游形状（`platform/platform-impl/src/com/intellij/openapi/wm/impl/status/FatalErrorWidgetFactory.java`）：
//   · 组件本体是 `IdeMessagePanel`（读 `MessagePool` 里的错误），**用户不可开关**：
//     `isConfigurable() = false` 且 `canBeEnabledOn(statusBar) = false`（`:32-42`）——
//     也就是说它不进勾选清单，自己按"有没有内部错误"显形。
//   · `MessagePool` 是**进程内**的错误累积（不读日志文件），所以"这一轮出过几次"是准确答案。
//
// 本仓的对应：宿主 `native/diagnostics.cpp` 的 `event(..., "ERROR", ...)` 顺手记一笔，
// `app.internalErrors` 报出 `{ count, latest }`。前端只在 `count > 0` 时显示芯片，
// 点开是**错误对话框**（`src/components/InternalErrorsDialog.vue`，上游 `IdeErrorsDialog` 的等价物），
// 簇与文案在 `src/errorReport.ts`。
//
// 没有做的事（如实，详见 src/errorReport.ts 的头注）：没有异常栈（宿主是 C++，账本里只有一行消息；
// 崩溃栈在 `taocode.log` 里，不进这张账）、没有插件归因、没有提交报告的入口
// —— 本仓没有上报渠道，芯片点开只有「复制」与「显示日志」。

/** 上游 `status.bar.fatal.error.widget.name`（中文包取值）。 */
export const INTERNAL_ERROR_WIDGET_NAME = '内部错误'

export interface InternalError { time: string; message: string }
export interface InternalErrors { count: number; latest: InternalError[] }

/** 芯片上那句话（上游 `IdeMessagePanel` 的计数字样）。 */
export function internalErrorLabel(count: number): string {
  return `${count} 个内部错误`
}

/**
 * 芯片该不该显形：有错误才显（上游那个组件就是"有内容才可见"）。
 * 另外**只在桌面端**显 —— 预览模式没有宿主，`app.internalErrors` 恒返回 0。
 */
export function shouldShowInternalErrors(errors: InternalErrors | null, isDesktop: boolean): boolean {
  return isDesktop && errors !== null && errors.count > 0
}

/** 最新的那一条的摘要（芯片 tooltip 的第一行用）。没有错误时返回空串。 */
export function latestInternalError(errors: InternalErrors | null): string {
  const latest = errors?.latest.at(-1)
  return latest ? `${latest.time} ${latest.message}` : ''
}