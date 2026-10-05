// 宏菜单（EditMenu 内的 `Macros` 子菜单）—— IDEA `PlatformActions.xml:506-510`。
//
// 源码成员与顺序（`<group id="Macros" popup="true"><group id="StandardMacroActions">`）：
//   PlaybackLastMacro      → ✅ 回放上一个宏（`lastMacro`，录制或回放过的那一个）
//   StartStopMacroRecording→ ✅ 开始/停止宏录制（Toggle：录制中标题变成「停止宏录制」）
//   EditMacros             → ✅ 编辑宏…（对话框：查看步骤 / 删步骤 / 删宏 / 重命名 / 回放）
//   PlaySavedMacrosAction  → ✅ 已保存的宏（每个命名宏一行；回放中禁用 —— `InvokeMacroAction.update`
//                              的 `setEnabled(!isPlaying)` 就是防递归）
// 位置（`:500-510`）：紧接 `ConvertIndentsGroup` 之后，所以 TaoCode 的编辑菜单里也放在「转换缩进」后面。
import type { MenuRow } from './types'

export interface MacrosMenuContext {
  // 参数统一 any：参数逆变下 App 的窄签名函数才能赋进来（后续批次可收紧）。
  macros: any
  namedMacros: any
  recording: any
  playing: any
  lastMacro: any
  toggleMacroRecording: any
  playLastMacro: any
  playMacro: any
  openMacrosDialog: any
}

export function createMacrosMenuRows(ctx: MacrosMenuContext): MenuRow[] {
  // 动态：宏表一变，子菜单立刻跟着变（IDEA 的 `ActionGroup.getChildren()` 就是这个语义）。
  const savedRows = (): MenuRow[] => ctx.namedMacros.value.map((macro: any) => ({
    id: `Macro.${macro.name}`,
    title: macro.name,
    keywords: `macro playback ${macro.name}`,
    enabled: () => !ctx.playing.value,
    run: () => void ctx.playMacro(macro),
  }))
  return [
    { id: 'edit.macros', title: '宏', keywords: 'macro record playback 宏 录制 回放', children: [
      // `PlaybackLastMacroAction`：没有录过/回放过任何宏时按 IDEA 的样子禁用（标题固定，不猜名字）。
      { id: 'edit.playbackLastMacro', title: '回放上一个宏', keywords: 'playback last macro 回放 上一个宏', enabled: () => Boolean(ctx.lastMacro.value) && !ctx.playing.value, run: () => void ctx.playLastMacro() },
      // `StartStopMacroRecordingAction`：一个动作两种文本（IDEA 的 ToggleAction）。
      { id: 'edit.startStopMacroRecording', title: ctx.recording.value ? '停止宏录制' : '开始宏录制', keywords: 'start stop macro recording 开始 停止 录制 宏', enabled: () => !ctx.playing.value, run: () => void ctx.toggleMacroRecording() },
      { id: 'edit.macroRule1', rule: true },
      { id: 'edit.editMacros', title: '编辑宏…', keywords: 'edit macros 编辑宏', run: () => void ctx.openMacrosDialog() },
      { id: 'edit.playSavedMacros', title: '已保存的宏', keywords: 'play saved macros 已保存 宏', enabled: () => savedRows().length > 0, childrenOf: savedRows },
    ] },
  ]
}
