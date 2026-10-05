// 退出确认：对应 IDEA 的 ConfirmExitDialog（GeneralSettingsConfigurable.kt:58 的
// `confirmExit` descriptor + ApplicationImpl.canExit :1073 → DoNotAskOption :1002-1018）。
// 「不再询问」勾选会把 GeneralSettings.confirmExit 写回 false（:1012-1018 的 setToBeShown）。
// 逻辑从 App.vue 拆出，依赖通过 ctx 注入（App 保留模板绑定所需的同名变量）。
import { ref, type Ref } from 'vue'
import { request } from '../bridge.ts'
import type { GeneralSettingsState } from '../bridge'
import { errorMessage } from '../errors.ts'

export interface ExitConfirmationContext {
  generalSettings: Ref<GeneralSettingsState>
  /** 是否处于打开的项目中（IDEA 的 canExit 只在有两个及以上已打开项目时才问）。 */
  hasOpenProject: () => boolean
  notify: (message: string, error?: boolean) => void
}

export function createExitConfirmation(ctx: ExitConfirmationContext) {
  const exitPrompt = ref(false)
  const exitPromptDontAsk = ref(false)
  let exitResolver: ((approved: boolean) => void) | null = null
  /** `isToBeShown()` (:1002-1004) — the setting and the open-project count, in that order. */
  function shouldConfirmExit(): boolean {
    return ctx.generalSettings.value.confirmExit && ctx.hasOpenProject()
  }
  function confirmExit(): Promise<boolean> {
    if (!shouldConfirmExit()) return Promise.resolve(true)
    exitPromptDontAsk.value = false
    exitPrompt.value = true
    return new Promise<boolean>(resolve => { exitResolver = resolve })
  }
  function resolveExit(approved: boolean) {
    const dontAsk = exitPromptDontAsk.value
    exitPrompt.value = false
    const resolve = exitResolver
    exitResolver = null
    if (approved && dontAsk) void saveConfirmExitPreference(false)
    resolve?.(approved)
  }
  /** The DoNotAskOption's `setToBeShown` (:1012-1018): the checkbox turns the setting off. */
  async function saveConfirmExitPreference(value: boolean) {
    const previous = ctx.generalSettings.value
    ctx.generalSettings.value = { ...previous, confirmExit: value }
    try {
      ctx.generalSettings.value = await request<GeneralSettingsState>('settings.general.update', { general: ctx.generalSettings.value })
    } catch (error) {
      ctx.generalSettings.value = previous
      ctx.notify(`退出确认的设置没有保存成功：${errorMessage(error)}`, true)
    }
  }
  return { exitPrompt, exitPromptDontAsk, shouldConfirmExit, confirmExit, resolveExit, saveConfirmExitPreference }
}
