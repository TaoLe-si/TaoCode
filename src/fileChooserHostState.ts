// 应用内文件/目录选择器（`FileChooserDialog`）的**宿主状态** —— 一次调用的生命周期。
//
// 为什么单独成文件：App.vue 只剩几十行机检余量，而这一族要装的是「打开 → 描述件 → 用户挑 → 复核 →
// 交给调用方」这一整条异步链（`src/components/FileChooserDialog.vue` 246 行画的是里面那一半）。
//
// 与上游的分工（`platform/platform-impl/.../fileChooser/FileChooserDialog.java`）：
//   · `FileChooser` 是**一次调用**（打开 → 选 → 返回），本模块就是它的等价物；
//   · `FileChooserDialogFactory.createChooser(...)`（描述件的预设）复用
//     `src/fileChooserDescriptor.ts` 的 `singleFileDescriptor()` / `singleDirDescriptor()` 等；
//   · 选完之后上游还要过 `FileChooserDescriptor.isFileSelectable`（`FileChooserDescriptor.java:326-337`），
//     本仓对应 `selectionProblem`（`src/fileChooserDescriptor.ts:262`）—— 本模块复用它，不重写判据。
//
// 「先应用内、后系统」两级：组件里 emit `outside`（工作区外的条目 / 「用系统对话框…」）时，本模块
// 转交宿主原生对话框（`native/dialogs.cpp` 的 `dialog.pickFile`/`dialog.pickDirectory`），
// 与上游 `FileChooserDialog` 自己在对话框里提供「系统原生选择」入口是同一件事。
import { ref } from 'vue'
import { request } from './bridge.ts'
import { chooseHostMethod, selectionProblem, type FileChooserDescriptor } from './fileChooserDescriptor.ts'

/** 一次待完成的调用。`resolve` 是给调用方的回执（选了路径 / 用户取消 / 复核不通过）。 */
interface PendingChooser {
  descriptor: FileChooserDescriptor
  initial: string
  resolve: (path: string | null, problem: string | null) => void
}

export interface FileChooserHostDeps {
  /** 提示用户（复核不通过时把上游那句判据原文报出来）。 */
  notify: (message: string, error?: boolean) => void
  /** 工作区根（相对路径的锚点；工作区本身是 `''`）。没有工作区 = 空串。 */
  workspaceRoot: () => string
  /** 最近位置（`FileChooserDialog` 左栏那一段）。 */
  recent: () => readonly string[]
  /** 收藏位置。 */
  favorites: () => readonly string[]
}

export function createFileChooserHost(deps: FileChooserHostDeps) {
  const { notify, workspaceRoot, recent, favorites } = deps
  const chooser = ref<PendingChooser | null>(null)

  /** 宿主原生那条通道（老宿主没有就是不可用，如实说而不是静默）。 */
  async function pickNatively(descriptor: FileChooserDescriptor, initial: string): Promise<string | null> {
    const method = chooseHostMethod(descriptor)
    try {
      return method === 'dialog.pickFile'
        ? await request<string | null>('dialog.pickFile', { title: descriptor.title, initial })
        : await request<string | null>('dialog.pickDirectory', { title: descriptor.title, initial })
    } catch (error) {
      notify(error instanceof Error ? error.message : '系统文件对话框打不开。', true)
      return null
    }
  }

  /**
   * 打开一次选择（上游 `FileChooser.choose(...)`）。返回的 Promise 在用户选定或取消后 resolve。
   * 组件没挂（没有工作区）时**不假装**——直接退回宿主原生对话框，那条路一直都在。
   */
  function choose(descriptor: FileChooserDescriptor, initial = ''): Promise<string | null> {
    if (chooser.value) { notify('已经有文件对话框打开了。', true); return Promise.resolve(null) }
    return new Promise<string | null>(resolve => {
      chooser.value = { descriptor, initial, resolve: (path, problem) => resolve(path) }
    })
  }

  /** 用户在应用内对话框里选中了：按描述件复核一遍（`isFileSelectable` 的等价物）。 */
  function onPick(path: string) {
    const pending = chooser.value
    if (!pending) return
    const kind = chooseHostMethod(pending.descriptor) === 'dialog.pickFile' ? 'file' : 'directory'
    const problem = selectionProblem(pending.descriptor, path, kind)
    chooser.value = null
    if (problem) { notify(problem, true); pending.resolve(null, problem); return }
    pending.resolve(path, null)
  }

  /** 「用系统对话框…」/ 工作区外条目：转交宿主原生通道（组件那一层画不出工作区外的内容）。 */
  async function onOutside(path: string) {
    const pending = chooser.value
    if (!pending) return
    const picked = await pickNatively(pending.descriptor, path || pending.initial)
    chooser.value = null
    if (picked === null) { pending.resolve(null, null); return }
    const kind = chooseHostMethod(pending.descriptor) === 'dialog.pickFile' ? 'file' : 'directory'
    const problem = selectionProblem(pending.descriptor, picked, kind)
    if (problem) { notify(problem, true); pending.resolve(null, problem); return }
    pending.resolve(picked, null)
  }

  /** 取消（Esc / 关闭按钮）。 */
  function onClose() {
    const pending = chooser.value
    if (!pending) return
    chooser.value = null
    pending.resolve(null, null)
  }

  return {
    chooser, choose, onPick, onOutside, onClose,
    descriptorOf: () => chooser.value?.descriptor ?? null,
    recent, favorites, workspaceRoot,
  }
}
