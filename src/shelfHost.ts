// 搁架的取数与三条动作（上游「搁架」工具窗口的工具栏那一半，见 `src/shelfTree.ts` 文件头）。
//
// 从 `SourceControl.vue` 拆出来：那个文件贴着 900 行机检上限，而这一段只与 `git stash` 通道
// 打交道，与变更列表/提交按钮不共职责。视图在 `src/components/ShelfPane.vue`。
//
// 三条动作：
//   · `load`  —— `git.stash`（native 的 `stash_list`，`git stash list --pretty=%gd\x1f%s`）；
//   · `save`  —— `git.stash.save`（`git stash push -m <信息>`，与 Git 菜单那一行同一份语义）；
//   · `pop`   —— `git.stash.pop`（带 `ref` 的 `git stash pop <ref>`，任意一条都能取；
//               非栈顶取回不会动上面的储藏，判据见 `src/shelfTree.ts` 的 `restoreBlockedReason`）。
import { ref, type Ref } from 'vue'
import { request, type DiffRow, type GitShowCommit } from './bridge.ts'
import type { GitStash, GitStashEntry } from './vcsLogTypes.ts'
import { shelfRows, type ShelfRow } from './shelfTree.ts'

export interface ShelfHostDeps {
  /** 当前工作区根（空 = 不请求）。 */
  root: () => string
  /** 每次动作成功后的刷新（变更列表那一份）。 */
  onChanged?: () => void | Promise<void>
  /** 失败时的一句提示。 */
  onError: (message: string) => void
}

/** 一条储藏的差异预览（`git.showCommit` 对 `stash@{n}` 的结果，零 native 改动）。 */
export interface ShelfPreview {
  ref: string
  patch: string
  sides: DiffRow[]
}

export interface ShelfHost {
  entries: Ref<GitStashEntry[]>
  rows: Ref<ShelfRow[]>
  busy: Ref<boolean>
  /** 当前选中要预览的那一条（`''` = 没选）。 */
  selected: Ref<string>
  /** 当前预览的差异（null = 没开）。 */
  preview: Ref<ShelfPreview | null>
  load: () => Promise<void>
  save: () => void
  pop: (ref: string) => void
  /** 「查看差异」：用 `git.showCommit` 读这条储藏的补丁（见 `show` 的注释）。 */
  show: (ref: string) => void
  clearPreview: () => void
}

export function createShelfHost(deps: ShelfHostDeps): ShelfHost {
  const entries = ref<GitStashEntry[]>([])
  const rows = ref<ShelfRow[]>([])
  const busy = ref(false)
  const selected = ref('')
  const preview = ref<ShelfPreview | null>(null)

  async function load() {
    if (!deps.root()) { entries.value = []; rows.value = []; return }
    try {
      entries.value = (await request<GitStash>('git.stash')).entries
    } catch {
      entries.value = []   // 非 git 目录/读不到：整节当空，不影响变更列表
    }
    rows.value = shelfRows(entries.value)
    // 列表变了（pop / 新建 / 别的窗口改了）：预览的那一条若已不在，把预览与选中态一起收掉
    // —— 留着一条指向不存在 ref 的预览，用户点「查看差异」看到的是上一次的内容。
    if (preview.value && !entries.value.some(entry => entry.ref === preview.value!.ref)) clearPreview()
    else if (selected.value && !entries.value.some(entry => entry.ref === selected.value)) selected.value = ''
  }

  function act(operation: () => Promise<unknown>, failure: string) {
    if (busy.value) return
    busy.value = true
    void (async () => {
      try { await operation(); await load(); await deps.onChanged?.() }
      catch (caught) { deps.onError(`${failure}：${caught instanceof Error ? caught.message : String(caught)}`) }
      finally { busy.value = false }
    })()
  }

  /** 「储藏当前更改」：与 Git 菜单那一行同一份语义（`git.stash.save` + 带时间戳的信息）。 */
  function save() {
    act(() => request('git.stash.save', { message: `TaoCode 储藏 ${new Date().toISOString().slice(0, 19).replace('T', ' ')}` }), '储藏失败')
  }

  /** 「取回」：任意一条都能取回（native 收 `ref`，非栈顶走 `git stash pop stash@{n}`）。 */
  function pop(ref: string) {
    const row = rows.value.find(entry => entry.ref === ref)
    if (!row || !row.restorable) return
    act(() => request('git.stash.pop', { ref }), '取回储藏失败')
  }

  /**
   * 「查看这条储藏的差异」（上游搁架树的预览面：`ShelvedChangesViewManager` 的 `SHELF_PREVIEW`
   * 那一档，选中一条就把它含的改动并排显示出来）。
   *
   * **零 native 改动就能做**：`stash@{n}` 是一个**合法 revision**，宿主的 `git.showCommit`
   * 已经收任意 revision（`native/git.cpp` 的 `show_commit` → `git show --format= -m --first-parent <rev>`
   * + `history::diff_sides_from_unified`），实测 `git show --first-parent 'stash@{0}'` 出来的正是
   * 这条储藏含的补丁。所以这一档直接用现有通道，不新开 `git.stash.show`（`Method` union 与
   * `native/main.cpp` 都是禁改文件，新方法进不去）。
   *
   * 与上游的差异如实写：`git stash show` 默认只给**已跟踪**文件的差异（未跟踪的那一份在
   * stash 的第三个 parent 里），本仓这一档也一样 —— 补丁里没有的改动就是没显示，不编。
   */
  function show(ref: string): void {
    const row = rows.value.find(entry => entry.ref === ref)
    if (!row) return
    selected.value = ref
    act(async () => {
      const detail = await request<GitShowCommit>('git.showCommit', { revision: ref })
      preview.value = { ref, patch: detail.patch, sides: detail.sides }
    }, '读取储藏差异失败')
  }

  /** 关掉差异预览（选中态一并清掉）。 */
  function clearPreview(): void {
    preview.value = null
    selected.value = ''
  }

  return { entries, rows, busy, selected, preview, load, save, pop, show, clearPreview }
}
