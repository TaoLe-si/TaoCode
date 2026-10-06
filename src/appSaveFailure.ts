// 保存失败那三档的「说什么 / 要不要弹冲突框 / 要不要把标签切成只读」—— App.vue 的 `save()`
// catch 分支（原 1145-1155 行）。
// 2026-10-06 逐字搬入本文件：三档文案（含中文引号与「文件属性 → 切换只读」那句）与判定顺序
//（先 CONFLICT、再 READ_ONLY、其余走 `errorMessage(error)`）保持原样。
//
// 上游坐标随注释搬家（原话，未改一字）：
//   「IDEA's "Reload from Disk / Keep Files": offer the choice instead of only a
//     message, so a disk change never forces a close-and-reopen.」
//
// 为什么能搬：`BridgeError` 的实例判断留在宿主（那要 import 桥接模块，搬过来会让本文件依赖宿主层），
// 这里只吃「错误码 + 路径 + 兜底文案」三样输入，产出「提示什么 + 宿主还要做哪两件事」。
export type SaveFailure = {
  message: string
  /** CONFLICT：宿主把 `conflictPrompt` 摆出来（Reload from Disk / Keep Files 那一框）。 */
  conflict: boolean
  /** READ_ONLY：宿主把标签与编辑器都标成只读。 */
  readOnly: boolean
}

export function saveFailureFor(code: string | null, path: string, fallbackMessage: string): SaveFailure {
  if (code === 'CONFLICT') {
    // IDEA's "Reload from Disk / Keep Files": offer the choice instead of only a
    // message, so a disk change never forces a close-and-reopen.
    return { message: `${path} 在磁盘上已被外部修改，保存已阻止。可重新载入磁盘版本，或保留当前修改后另存。`, conflict: true, readOnly: false }
  }
  if (code === 'READ_ONLY') {
    return { message: `${path} 是只读文件；用右键菜单「文件属性 → 切换只读」解除后再保存。`, conflict: false, readOnly: true }
  }
  return { message: fallbackMessage, conflict: false, readOnly: false }
}
