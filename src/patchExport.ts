// 本地更改的**补丁导出**（上游 `ChangesView.CreatePatch` / `CreatePatchToClipboard`）。
//
// 上游那两条（`VcsActions.xml:212-214`，改动列表那四项 `:208-211` 之后、Shelve `:215` 之前）：
//   · `ChangesView.CreatePatch` = 「从本地更改创建补丁…」（`platform/platform-resources-en/src/messages/ActionsBundle.properties:1564`
//     `action.ChangesView.CreatePatch.text`）——
//     弹一个"创建补丁"对话框（勾选要包含的更改 + 目标文件），落成 `.patch`；
//   · `ChangesView.CreatePatchToClipboard` = 「作为补丁复制到剪贴板」（`platform/platform-resources-en/src/messages/ActionsBundle.properties:1583`
//     `action.ChangesView.CreatePatchToClipboard.text`）—— 同一份文本进剪贴板。
//
// 本仓的实现口径：补丁文本来自宿主的 `git.patch` —— 里面是 **`git diff HEAD`**（暂存区与工作区一起；
// 单跑 `git diff` 只有未暂存那一半）**再按"新文件"接上未跟踪的文件**
// （`git diff --no-index -- /dev/null <file>`，与上游把未跟踪文件当新文件加进去同义）。
// 目标文件走宿主的保存对话框（`dialog.saveFile`）与写盘通道（`app.writeExportFiles`）。
import { request } from './bridge.ts'   // 带扩展名：这个模块能被 node --test 直接加载（见 tests/patch-export.test.mjs）

/** 补丁文件的保存对话框过滤（上游 `CreatePatchFromChangesAction` 的 `FILE_EXTENSION = "patch"`）。 */
export const PATCH_FILTERS = [{ name: '补丁文件', pattern: '*.patch' }]
/** `action.ChangesView.CreatePatch.text`。 */
export const CREATE_PATCH_TEXT = '从本地更改创建补丁…'
/** `action.ChangesView.CreatePatchToClipboard.text`。 */
export const PATCH_TO_CLIPBOARD_TEXT = '作为补丁复制到剪贴板'

export interface PatchDeps {
  /** 一句结果/失败提示（`error = true` 时是失败）。 */
  notify: (message: string, error?: boolean) => void
  /** 复制通道（默认走 `src/clipboard.ts` 的中央入口，测试里可换）。 */
  copy: (text: string) => void | Promise<void>
}

/** 本地更改的补丁文本（`git diff HEAD`：暂存 + 未暂存）。 */
export async function localPatchText(): Promise<string> {
  const result = await request<{ patch: string }>('git.patch', { includeUntracked: true })
  return result.patch ?? ''
}

/** 「从本地更改创建补丁…」：没有更改就不弹对话框；选了路径就写盘。 */
export async function createPatchFile(deps: PatchDeps): Promise<void> {
  try {
    const text = await localPatchText()
    if (!text.trim()) { deps.notify('没有本地更改，未创建补丁。'); return }
    const target = await request<string | null>('dialog.saveFile', { title: '从本地更改创建补丁', filters: PATCH_FILTERS, name: 'changes.patch' })
    if (!target) return
    await request('app.writeExportFiles', { files: [{ path: target, content: text }] })
    deps.notify(`已创建补丁：${target}`)
  } catch (caught) { deps.notify(`创建补丁失败：${caught instanceof Error ? caught.message : String(caught)}`, true) }
}

/** 「作为补丁复制到剪贴板」：没有更改就不动剪贴板。 */
export async function copyPatchToClipboard(deps: PatchDeps): Promise<void> {
  try {
    const text = await localPatchText()
    if (!text.trim()) { deps.notify('没有本地更改，剪贴板未改动。'); return }
    await deps.copy(text)
    deps.notify('已把本地更改作为补丁复制到剪贴板。')
  } catch (caught) { deps.notify(`复制补丁失败：${caught instanceof Error ? caught.message : String(caught)}`, true) }
}
