# 一次性脚本：把 App.vue 的「VCS 动作」域搬到 src/vcsActions.ts
# 四段不连续区间：分支弹窗+分支动作、blame/clipboardDiff 状态、blame/与剪贴板比较、Git 菜单动作。
import io

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\vcsActions.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

ANCHORS = [
    ('// IDEA 的分支弹窗（`GitBranchesPopup`）：工具栏分支 widget 与「Git › 分支…」都打开它，',
     'const blameLines = ref<GitBlameLine[]>([])'),
    ('const blameLines = ref<GitBlameLine[]>([])', None),
    ('async function showBlame() {', 'function copyFilePath() {'),
    ('// The Git menu drives the same bridge methods as the 源代码管理 tool window. Stash',
     '// 全局快捷键分派是一个域（IDEA 的 Keymap/KeymapImpl + $default.xml 的绑定表）。'),
]

idx = lambda s: next(i for i, l in enumerate(lines) if s in l)
for a, _ in ANCHORS:
    assert text.count(a) == 1, (a, text.count(a))

a1 = idx(ANCHORS[0][0]); b1 = idx(ANCHORS[0][1]) - 1          # 2298..2339（含 compareWithBranch 的 }）
a2 = idx('const blameLines = ref<GitBlameLine[]>([])'); b2 = a2 + 2
a3 = idx('async function showBlame() {'); b3 = idx('function copyFilePath() {') - 1
a4 = idx(ANCHORS[3][0]); b4 = idx(ANCHORS[3][1]) - 1

assert (a1, a2, b2, a3, b3, a4, b4) == (2297, 2339, 2341, 2361, 2381, 2955, 3010), (a1 + 1, a2 + 1, b2 + 1, a3 + 1, b3 + 1, a4 + 1, b4 + 1)
assert lines[b1].strip() == '}', lines[b1]
assert lines[b3].strip() == '}', lines[b3]
assert lines[b4].strip() == '}', lines[b4]

r1 = lines[a1:b1 + 1]
r2 = lines[a2:b2 + 1]
r3 = lines[a3:b3 + 1]
r4 = lines[a4:b4 + 1]
assert len(r1) == 42 and len(r2) == 3 and len(r3) == 21 and len(r4) == 56, (len(r1), len(r2), len(r3), len(r4))

ASSEMBLY = '''// 版本控制动作是一个域（IDEA 的 Git 菜单 + GitBranchesPopup + Annotate）。
const {
  branchPopupOpen, openBranchPopup, onBranchAction, refreshTreeVersion, gitCompareWith, compareWithBranch,
  blameLines, blamePath, clipboardDiff, showBlame, compareWithClipboard,
  updateProject, resetHeadDialog, pushWithConfirm, gitMenuAction,
} = createVcsActions({ notify, isDesktop, workspace, gitAvailable, refreshGitWidget, treeVersion, activePath, active, bottom, showOutput, showView })'''

HEADER = '''// 版本控制动作 —— 从 App.vue 搬出的一域（122 行，11 个依赖）。
//
// 判据：IDEA 把 Git 的**用户可见动作**放在 `VcsActions.xml` 的菜单 + 各 popup 里，TaoCode 的对应物
// 就是这一组：分支弹窗（`GitBranchesPopup`）、分支操作（checkout/create/delete/rebase/merge/compare）、
// 追溯（Annotate = `git.blame`）、与剪贴板比较（Compare with Clipboard）、以及 Git 菜单的
// 更新项目 / 重置 HEAD / 推送 / 储藏。它们共享 `branchPopupOpen` / `blameLines` / `clipboardDiff`
// 三类结果状态，并且都走同一条 `git.*` 原生通道。
// 状态栏的分支 widget（`refreshGitWidget`）留在 App.vue：它是 30 秒轮询的常驻部件，不是动作。
import { nextTick, ref } from 'vue'
import { request, type DiffRow, type GitAheadBehind, type GitBlame, type GitBlameLine } from './bridge'
import { buildDiffRows, generateUnifiedDiff } from './diffText'
import { errorMessage } from './errors'
import type { Tab } from './editorTab'

export interface VcsActionsDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  workspace: any
  gitAvailable: any
  /** 状态栏的分支/变更指示器（宿主自有轮询）。 */
  refreshGitWidget: () => Promise<void>
  /** 文件树代次（分支切换后要刷新树）。 */
  treeVersion: any
  activePath: { readonly value: string }
  active: { readonly value: Tab | undefined }
  bottom: any
  showOutput: (id: any) => void
  showView: (id: any) => void
}

export function createVcsActions(deps: VcsActionsDeps) {
  const { notify, isDesktop, workspace, gitAvailable, refreshGitWidget, treeVersion, activePath, active, bottom,
          showOutput, showView } = deps
'''

FOOTER = '''
  return {
    branchPopupOpen, openBranchPopup, onBranchAction, refreshTreeVersion, gitCompareWith, compareWithBranch,
    blameLines, blamePath, clipboardDiff, showBlame, compareWithClipboard,
    updateProject, resetHeadDialog, pushWithConfirm, gitMenuAction,
  }
}
'''

module_text = HEADER + '\n'.join(r1) + '\n' + '\n'.join(r2) + '\n' + '\n'.join(r3) + '\n' + '\n'.join(r4) + FOOTER
io.open(MOD, 'w', encoding='utf-8', newline='\n').write(module_text)

new_lines = (lines[:a1] + ASSEMBLY.split('\n') + lines[b1 + 1:a2] + lines[b2 + 1:a3] + lines[b3 + 1:a4] + lines[b4 + 1:])
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_lines))
print('r1/r2/r3/r4:', len(r1), len(r2), len(r3), len(r4))
print('App.vue:', len(lines), '->', len(new_lines))
