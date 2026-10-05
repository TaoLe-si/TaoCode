<script setup lang="ts">
// 重构预览对话框 —— 上游 `platform/lang-impl/src/com/intellij/refactoring/ui/RefactoringDialog.java`
// + `UsageViewImpl` 那一层在 TaoCode 的等价物。
//
// 形态逐条照上游（坐标见各处注释）：
//   · 标题 + 一行摘要（`RefactoringDialog` 的 `setTitle` / `getDimensionServiceKey`；摘要取
//     `buildRefactorPreview` 的 `summary`，与 `UsageInfo` 树根节点那一行同层）；
//   · 中间是**用法树**：目录 → 文件 → 位置（`UsageViewImpl` 的 `UsageViewTreeStructureProvider`
//     分组规则在本仓的落点是 `src/usageViewGrouping.ts` 的 `buildUsageTree`），
//     每处印旧文本 → 新文本（`RefactoringPreviewComponent` / `PreviewUsage` 的 before/after）；
//   · 一个搜索选项复选框（「在注释和字符中搜索」：`RenameDialog.java:66/280-281`，
//     缺省勾上 `:281`）；
//   · 两个动作：重构 / 取消（`RefactoringDialog.java:225-239` 的 `createActions()` 里
//     `getRefactorAction()`（`:245-257`，带 `DEFAULT_ACTION`）、`getCancelAction()`；
//     中间那个 `PreviewAction`（`:259-273`）在对话框没有别处可看时才需要 —— 本仓树本身就是预览，
//     所以省掉它，与 `hasPreviewButton()`（`:220-222`）可关是同一类取舍）。
//
// 与上游的如实差异：
//   ① 树节点没有**用法类型**图标（读/写/调用…）。上游靠 `UsageInfo.getUsageInfo`（PSI 语义），
//      LSP `textDocument/references` 不回 kind，本仓只给位置与前后文本；
//   ② 没有「在编辑器中打开」勾选框（`RefactoringDialog.java:63-83` 的 `addOpenInEditorCheckbox`）
//      —— 本仓点位置直接跳编辑器（宿主 `revealLocation` 承接，不在本对话框里）；
//   ③ 「冲突」那一档是本仓自加的可见化：上游在 processor 里就抛了
//      （`BaseRefactoringProcessor` 的冲突路径），本仓的冲突检测在 `src/renamePreview.ts`，
//      所以在 UI 上把「重构」置灰并说明原因。
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import type { RefactorPreviewNode, PreviewRow } from '../refactorPreview'

/** 对话框要印的模型（宿主在 `semanticActions` 里算好后传进来；本组件不请求、不写盘）。
 *  字段名与 `src/semanticActions.ts:529-538` 的 `refactorPreviewState` **逐字一致** ——
 *  那里就是按「与本文件一一对应」写的（`:528`），所以标题那一栏叫 `label` 而不是 `title`：
 *  它是那次重构的名字（`openRefactorPreview({ label: '重命名', … })`，`:502`），不是 HTML 属性。 */
export interface RefactorPreviewModel {
  /** 标题（上游 `RefactoringBundle.properties:145` `rename.title` = Rename，zh 包 = 重命名）。 */
  label: string
  /** 摘要那一行：`N 个文件 · M 处修改 · K 处冲突`。 */
  summary: string
  /** 用法树（目录 → 文件 → 位置）。 */
  tree: RefactorPreviewNode
  /** 冲突处数 > 0 时「重构」不可用（对齐上游「有冲突就不给跑」）。 */
  conflictCount: number
  /** 冲突说明（空串 = 没冲突）。 */
  conflictText: string
  /** 「在注释和字符中搜索」那一档是否出现（没有非代码扫描能力时为 false，整行不渲染）。 */
  showSearchInComments: boolean
  searchInComments: boolean
  searchInCommentsSummary: string
  /** 计算/扫描进行中：禁用「重构」并说明在等什么。 */
  busy: boolean
}

const props = defineProps<{ model: RefactorPreviewModel }>()
const emit = defineEmits<{
  (event: 'refactor', searchInComments: boolean): void
  (event: 'cancel'): void
  (event: 'toggleSearchInComments', value: boolean): void
  (event: 'open', location: { path: string; line: number }): void
}>()

/** 树里的一行：`node` 是目录/文件，位置行在 `rows` 里（只有文件有）。 */
interface TreeLine { kind: 'directory' | 'file' | 'row'; depth: number; name: string; count: number; row?: PreviewRow }

/**
 * 把树摊平成一串带深度的行。目录与文件用 `<details>` 承载折叠（零 JS 状态），
 * 位置行摊平后只画一份标记 —— 目录深度不固定，递归子组件在这个体量下不划算。
 * 目录排在文件之前（分组规则的顺序，见 `usageViewGrouping.buildUsageTree`）。
 */
function flatten(node: RefactorPreviewNode, depth: number, out: TreeLine[]): TreeLine[] {
  out.push({ kind: node.kind, depth, name: node.name, count: node.count })
  for (const child of node.children) {
    if (child.kind === 'file') {
      out.push({ kind: 'file', depth: depth + 1, name: child.name, count: child.count })
      for (const row of child.rows) out.push({ kind: 'row', depth: depth + 2, name: row.path, count: 0, row })
    } else flatten(child, depth + 1, out)
  }
  return out
}

const lines = computed<TreeLine[]>(() => flatten(props.model.tree, 0, []))
const canRefactor = computed(() => props.model.conflictCount === 0 && !props.model.busy)

function toggleSearch(event: Event) {
  emit('toggleSearchInComments', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('cancel')">
    <section class="command-palette refactor-preview" role="dialog" aria-modal="true" :aria-label="model.label">
      <div class="palette-input">
        <span class="refactor-preview-heading">{{ model.label }} — {{ model.summary }}</span>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('cancel')"><X :size="iconSize.action" /></button>
      </div>

      <!-- 用法树：目录 → 文件 → 位置（`UsageViewImpl` 的树结构）。 -->
      <div class="refactor-preview-body">
        <ul v-if="lines.length" class="refactor-preview-tree" role="tree" aria-label="将要改动的地方">
          <li v-for="(line, index) in lines" :key="`${line.kind}:${line.depth}:${line.name}:${index}`"
            role="treeitem" :aria-level="line.depth + 1"
            :aria-expanded="line.kind === 'row' ? undefined : 'true'">
            <details v-if="line.kind === 'row'" open>
              <summary class="refactor-preview-row" :class="{ conflict: line.row?.conflict }"
                :title="line.row?.oldText ? `${line.row.path}:${(line.row.line ?? 0) + 1}` : '拿不到该处原文，只显示位置'"
                @click="line.row && emit('open', { path: line.row.path, line: line.row.line })">
                <span class="refactor-preview-pos">{{ (line.row?.line ?? 0) + 1 }}:{{ (line.row?.column ?? 0) + 1 }}</span>
                <span v-if="line.row?.oldText" class="refactor-preview-before">{{ line.row.oldText }}</span>
                <span v-if="line.row?.oldText" class="refactor-preview-arrow" aria-hidden="true">→</span>
                <span class="refactor-preview-after">{{ line.row?.newText }}</span>
              </summary>
            </details>
            <summary v-else class="refactor-preview-node" :class="`is-${line.kind}`">
              <span class="refactor-preview-name">{{ line.name }}</span>
              <span class="refactor-preview-count">{{ line.count }}</span>
            </summary>
          </li>
        </ul>
        <p v-else class="refactor-preview-empty">没有可预览的改动。</p>
      </div>

      <footer class="refactor-preview-foot">
        <!-- 搜索选项（上游 `SafeDeleteDialog.java:149` / `RenameDialog.java:280-281` 同一个复选框，
             缺省勾上 `RenameDialog.java:281`）。 -->
        <label v-if="model.showSearchInComments" class="refactor-preview-option">
          <input type="checkbox" :checked="model.searchInComments" :disabled="model.busy" @change="toggleSearch" />
          <span>在注释和字符中搜索</span>
        </label>
        <p v-if="model.showSearchInComments" class="refactor-preview-option-note">{{ model.searchInCommentsSummary }}</p>
        <p v-if="model.conflictText" class="refactor-preview-conflict" role="alert">{{ model.conflictText }}</p>
        <div class="dialog-actions">
          <button class="subtle-button" @click="emit('cancel')">取消</button>
          <button class="primary-button" :disabled="!canRefactor" @click="emit('refactor', model.searchInComments)">重构</button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.refactor-preview { width: min(760px, calc(100vw - 32px)); display: flex; flex-direction: column; }
.refactor-preview-heading { color: var(--bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.refactor-preview-body { min-height: 0; max-height: min(56vh, 480px); overflow: auto; border-top: 1px solid var(--line); }
.refactor-preview-tree { margin: 0; padding: var(--space-1); list-style: none; }
.refactor-preview-node, .refactor-preview-row { display: flex; align-items: baseline; gap: var(--space-2); padding: 2px var(--space-1); font-size: 12px; transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.refactor-preview-node { color: var(--muted); cursor: default; }
.refactor-preview-node.is-file { color: var(--text); }
.refactor-preview-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.refactor-preview-count { color: var(--muted); font-size: 10px; }
/* 位置行缩进跟着树的深度（目录/文件是 1:1 层，位置行比文件再深一级；
   令牌阶梯到 `--space-6`，更深的目录层级就都收到那一档，不再新造数值）。 */
.refactor-preview-tree li[aria-level="3"] > .refactor-preview-row { padding-left: var(--space-5); }
.refactor-preview-tree li[aria-level="4"] > .refactor-preview-row { padding-left: var(--space-6); }
.refactor-preview-tree li[aria-level="5"] > .refactor-preview-row,
.refactor-preview-tree li[aria-level="6"] > .refactor-preview-row { padding-left: var(--space-6); }
.refactor-preview-row { font: 11px var(--font-mono); cursor: pointer; transition: background-color var(--dur-1) var(--ease); }
.refactor-preview-row:hover { background: var(--selected); }
.refactor-preview-row.conflict { color: var(--error); }
.refactor-preview-pos { color: var(--muted); flex-shrink: 0; }
.refactor-preview-before { color: var(--muted); text-decoration: line-through; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.refactor-preview-arrow { color: var(--muted); flex-shrink: 0; }
.refactor-preview-after { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.refactor-preview-empty { padding: var(--space-3); color: var(--muted); }
.refactor-preview-foot { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2); border-top: 1px solid var(--line); }
.refactor-preview-option { display: flex; align-items: center; gap: var(--space-2); font-size: 12px; }
.refactor-preview-option-note, .refactor-preview-conflict { margin: 0; font-size: 11px; color: var(--muted); }
.refactor-preview-conflict { color: var(--error); }
</style>
