// 一次替换**没做完**时该怎么向用户交代（面板的状态行/错误行；纯判定，不碰状态）。
//
// 为什么要单独一层：宿主的回参里同时有「替换了多少」和「有多少根本没碰」，
// 只播前一句就是把不完整的操作报成成功 —— 上游的口径也是一致的：
// `platform/lang-impl/src/com/intellij/find/impl/FindPopupPanel.java:1573-1574` 在后台校验没跑完时
// 直接把 ValidationInfo（warning）挡在动作上，而不是先报"替换完成"再补一句警告。
//
// 三个计数的出处都在本仓宿主那一侧（行号是这次自己数的）：
//   · `skippedFiles` —— 扫描上限 `native/search.cpp:37` 的 `max_scanned_files = 100000`；
//     被它挡在门外、**一个字都没读**的勾选文件在 `:887` 那条注释里写明"reported as skippedFiles
//     instead of a clean 0 replacements"，回参在 `:921`。
//   · `truncated` —— 同一趟扫描的结果条数上限：命中清单本身不完整，替换只覆盖列出的那些。
//   · `skippedNonUtf8` —— UTF-8 与 GBK 都解不出来的文件（`src/bridge.ts:199` 的 `SearchReplaceResult`
//     把它与 `skippedFiles` 分列，两者是不同的"没参与"，不能合并成一个数）。
// 上游没有与本仓 100k 上限对应的那条硬限制（它走索引），所以这三句文案是**本仓形态**的等价物，
// 不冒充上游原话。
import type { SearchReplaceResult } from './bridge.ts'

/**
 * 替换结果不完整时的那一句（'' = 完整，面板不再叠一行）。
 *
 * `skippedFiles` 与 `truncated` 是**同一条上限的两种表现**（前者一个文件都没读到，后者读到了但
 * 清单被截），所以互斥地取更严重的那一句；编码那一档是独立原因，两句可以并存。
 */
export function incompleteNote(result: SearchReplaceResult): string {
  const skipped = Math.max(0, Math.trunc(result.skippedFiles ?? 0))
  const undecodable = Math.max(0, Math.trunc(result.skippedNonUtf8 ?? 0))
  const reasons: string[] = []
  if (skipped > 0) reasons.push(`有 ${skipped} 个勾选的文件因扫描上限未被处理`)
  else if (result.truncated === true) reasons.push('扫描被截断，可能还有未列出的匹配')
  if (undecodable > 0) reasons.push(`${undecodable} 个文件的编码无法识别，未参与搜索/替换`)
  if (!reasons.length) return ''
  return `⚠ 替换不完整：${reasons.join('；')}。请检查相关文件后重做。`
}
