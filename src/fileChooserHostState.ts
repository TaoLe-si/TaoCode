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
import { mergeRecentPaths, pushRecentPath } from './fileChooserModel.ts'

/**
 * 选过的路径（上游 `FileChooserUtil.RECENT_FILES` 那张表，`impl/FileChooserUtil.java:33-34`
 * 的键与 30 条上限、`:89-108` 的「新的排最前 + distinct + limit」）。
 * 上游落在 `PropertiesComponent`（应用级持久），本仓的应用级持久就是 localStorage；
 * 形状不对的条目逐条丢掉、整份坏掉退化成「没记过」（`FileChooserUtil.java:74-82` 读不到也是空表，
 * 不是缺省值 —— 更不会因此判存档损坏）。
 */
export const CHOOSER_RECENT_KEY = 'taocode.fileChooser.recentPaths'

/** 读盘（`store` 传 null / 假对象 = 没有记录；node --test 与隐私模式走这一档）。 */
export function readRecentPaths(store?: Pick<Storage, 'getItem'> | null): string[] {
  const target = store === undefined ? (typeof localStorage === 'undefined' ? null : localStorage) : store
  if (!target) return []
  let raw: string | null = null
  try { raw = target.getItem(CHOOSER_RECENT_KEY) } catch { return [] }
  try {
    const saved = JSON.parse(raw ?? 'null') as unknown
    if (!Array.isArray(saved)) return []
    return mergeRecentPaths(saved.filter((entry): entry is string => typeof entry === 'string'), [])
  } catch { return [] }
}

function writeRecentPaths(paths: readonly string[]): void {
  try { localStorage?.setItem(CHOOSER_RECENT_KEY, JSON.stringify([...paths])) } catch { /* 写不进去只是下次不记得，不影响这次选择 */ }
}

/** 一次待完成的调用。`resolve` 是给调用方的回执（选了路径 / 用户取消 / 复核不通过）。 */
interface PendingChooser {
  descriptor: FileChooserDescriptor
  initial: string
  resolve: (path: string | null, problem: string | null) => void
  /**
   * 左栏那两组的数据源，跟着这一次调用一起给出去（宿主挂点就是
   * `chooser.recent()` / `chooser.favorites()`，见 `src/App.vue` 的那一行 `<FileChooserDialog>`）。
   * `recent` 每次读都现算 ⇒ 记了新的那一档，对话框里的左栏立刻跟着变。
   */
  recent: () => readonly string[]
  favorites: () => readonly string[]
}

export interface FileChooserHostDeps {
  /** 提示用户（复核不通过时把上游那句判据原文报出来）。 */
  notify: (message: string, error?: boolean) => void
  /** 工作区根（相对路径的锚点；工作区本身是 `''`）。没有工作区 = 空串。 */
  workspaceRoot: () => string
  /** 最近位置的**第二档**（宿主另外给的那一份，例如编辑器历史）；
   *  第一档 = 选择器自己记的那些（上游 `storeSelection` 那一档）。两档合并、去重、上限 30。 */
  recent: () => readonly string[]
  /** 收藏位置（上游的文件选择器**没有**这一栏，见 `src/fileChooserModel.ts` 的 `favoriteShortcuts`
   *  订正说明；宿主给不出目录时左栏那一段就不渲染）。 */
  favorites: () => readonly string[]
}

export function createFileChooserHost(deps: FileChooserHostDeps) {
  const { notify, workspaceRoot, recent: recentSeed, favorites } = deps
  const chooser = ref<PendingChooser | null>(null)
  // 选择器自己记的那些路径（上游 `storeSelection` 那一条，`FileChooserDialogImpl.java:186-191`）。
  const chosen = ref<string[]>(readRecentPaths())

  /** 选中成功后记一笔（就地更新 ref ⇒ 模板里的 `recent()` 立刻跟着变）。 */
  function recordChosen(path: string) {
    chosen.value = pushRecentPath(chosen.value, path)
    writeRecentPaths(chosen.value)
  }

  /** 左栏「最近」那一段：选择器自己记的在前，宿主给的那一份在后（去重 + 上限 30）。 */
  const recentList = () => mergeRecentPaths(chosen.value, recentSeed())

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
      chooser.value = { descriptor, initial, recent: recentList, favorites, resolve: (path, problem) => resolve(path) }
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
    recordChosen(path)
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
    recordChosen(picked)
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
    /** 左栏「最近」那一段（与挂在这次调用上的那一份同一个函数）。 */
    recent: recentList,
    /** 只给选择器自己记的那一档（判据与排错用）。 */
    chosenRecent: () => [...chosen.value],
    favorites, workspaceRoot,
  }
}
