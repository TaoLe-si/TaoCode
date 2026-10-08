<script setup lang="ts">
// 三方合并编辑器（上游 `MergeThreesideViewer` 的三栏 + 结果栏，用本仓架构还原）。
//
// 数据来自**现有通道**：`file.read` 取工作区里那份带冲突标记的文件，行模型在
// `src/mergeEditor.ts`（纯算法，可单测）。写回走 `file.write`（带 `expectedVersion` 与
// 编码/BOM，与 `src/mergeResolveHost.ts` 同一条链）。**本仓不新增 git 通道** ——
// stage1/2/3 的 blob 要新增 `git.*` 方法，而方法名 union 在 `src/bridge.ts`、分派在
// `native/main.cpp`，两者都是本 lane 的禁改文件；冲突标记文本是 git 自己写进工作区的，
// 与 `src/mergeResolve.ts` / `src/components/MergeBar.vue` 同一份输入。
//
// 逐块接受与整文件接受：模型在 `src/mergeEditor.ts`（`acceptBlock` / `acceptBoth` /
// `acceptAllBlocks`）。「接受两者」是本仓扩展（上游只有左/右两个按钮，见那个模块的文件头）。
//
// 文案：接受左侧/右侧取 `DiffBundle.properties:250-251` 的中文包（`button.merge.resolve.accept.left/right`）；
// 三栏标题与「接受两者」的说明是本仓措辞（模块头已注明上游没有）。
import { computed, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, X, FileCheck2, Merge } from 'lucide-vue-next'
import { request } from '../bridge'
import { iconSize } from '../uiIcons'
// 「接受左/右侧」两颗走 IDEA 的 diff 方向箭头（`AllIcons.Diff.ArrowRight` / `.Arrow`，见 toolWindowIcons.ts）。
import { IdeaApplyLeftSideIcon, IdeaApplyRightSideIcon } from './icons/toolWindowIcons.ts'
import {
  ACCEPT_BOTH_NOTE, ACCEPT_BOTH_TEXT, AUTO_RESOLVABLE_NOTE, CONFLICT_BLOCK_LABEL, MERGE_TITLES, NO_BASE_NOTE,
  acceptAllBlocks, acceptBlock, acceptBoth, blockStatus, buildMergeEditorModel, stepBlock,
} from '../mergeEditor'
import { ACCEPT_LEFT_TEXT, ACCEPT_RIGHT_TEXT } from '../mergeConflicts'
// 「暂存内容…」把索引冲突三阶段的**真 blob**（`:1:` 基线 / `:2:` 我们的 / `:3:` 他们的）摆出来看 ——
// 上游三方合并查看器三个编辑器读的就是 stage1/2/3（`ThreesideMergeRequest.getContents()`），
// 本仓用 `RevisionCompareDialog.vue` 的 `stages` 模式 + `src/revisionContent.ts` 的 `loadMergeStages`
// 走现有 `git.showCommit` 的 `:<n>:<path>` 说明符（不新增 native 通道）。
import RevisionCompareDialog from './RevisionCompareDialog.vue'

const props = defineProps<{
  /** 冲突文件的路径（工作区相对 '/'）。 */
  path: string
  /** 关掉这个视图。 */
  closable?: boolean
}>()
const emit = defineEmits<{ close: []; applied: [path: string]; notify: [message: string, error?: boolean] }>()

interface FileFacts { content: string; version: string; encoding: string; bom: boolean }

const content = ref('')
const version = ref('')
const encoding = ref('utf-8')
const bom = ref(false)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
/** 当前块（导航与逐块接受都用它）。-1 = 还没选。 */
const current = ref(-1)

const model = computed(() => buildMergeEditorModel(content.value))
const blocks = computed(() => model.value.blocks)
const status = computed(() => blockStatus(blocks.value.length, current.value))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const read = await request<FileFacts>('file.read', { path: props.path })
    content.value = read.content ?? ''
    version.value = read.version ?? ''
    encoding.value = read.encoding ?? 'utf-8'
    bom.value = read.bom === true
    current.value = blocks.value.length ? 0 : -1
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally { loading.value = false }
}
watch(() => props.path, () => { void load() }, { immediate: true })

/** 写回文件（与 `mergeResolveHost` 同一条链：版本 + 编码 + BOM 一起带上）。 */
async function write(next: string, message: string) {
  busy.value = true
  error.value = ''
  try {
    await request('file.write', { path: props.path, content: next, expectedVersion: version.value, encoding: encoding.value, bom: bom.value })
    content.value = next
    // 重读版本（写之后版本变了，下一次写要拿新的，否则会被 native 的 expectedVersion 挡下）。
    const read = await request<FileFacts>('file.read', { path: props.path })
    version.value = read.version ?? ''
    emit('notify', message)
    emit('applied', props.path)
    if (!blocks.value.length) current.value = -1
    else if (current.value >= blocks.value.length) current.value = 0
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
    emit('notify', error.value, true)
  } finally { busy.value = false }
}
/** 逐块接受一侧（接受后这一块的标记没了，块数减一，所以把当前块夹回范围）。 */
function acceptOne(side: 'left' | 'right') {
  if (busy.value || current.value < 0) return
  const label = side === 'left' ? ACCEPT_LEFT_TEXT : ACCEPT_RIGHT_TEXT
  void write(acceptBlock(content.value, current.value, side), `${label}：第 ${current.value + 1} 块`)
}
/** 逐块接受两者（本仓扩展）。 */
function acceptBothOne() {
  if (busy.value || current.value < 0) return
  void write(acceptBoth(content.value, current.value), `${ACCEPT_BOTH_TEXT}：第 ${current.value + 1} 块`)
}
/** 整文件接受一侧（上游 `handleAcceptSide`：全部改动取那一侧）。 */
function acceptWhole(side: 'left' | 'right') {
  if (busy.value) return
  const label = side === 'left' ? ACCEPT_LEFT_TEXT : ACCEPT_RIGHT_TEXT
  void write(acceptAllBlocks(content.value, side), `${label}（整文件）`)
}
function step(forward: boolean) {
  current.value = stepBlock(blocks.value.length, current.value, forward)
}
/** 当前块的三格（模板里高亮用）。 */
const activeBlock = computed(() => blocks.value[current.value])
/** 「暂存内容…」面板开着吗（三阶段真内容的只读预览）。 */
const stagesOpen = ref(false)
</script>

<template>
  <div class="merge-editor" role="dialog" aria-modal="true" :aria-label="`合并 ${path}`">
    <div class="merge-head">
      <Merge :size="iconSize.control" />
      <span class="merge-title">{{ path }}</span>
      <span v-if="status" class="merge-status" role="status">{{ CONFLICT_BLOCK_LABEL }} {{ status }}</span>
      <span v-if="blocks.length && activeBlock?.resolvable" class="merge-auto" :title="AUTO_RESOLVABLE_NOTE"><FileCheck2 :size="iconSize.dense" />{{ AUTO_RESOLVABLE_NOTE }}</span>
      <div class="merge-nav" role="group" aria-label="冲突导航">
        <button class="find-icon-button" type="button" :disabled="!blocks.length" title="上一个冲突" aria-label="上一个冲突" @click="step(false)"><ChevronUp :size="iconSize.control" /></button>
        <button class="find-icon-button" type="button" :disabled="!blocks.length" title="下一个冲突" aria-label="下一个冲突" @click="step(true)"><ChevronDown :size="iconSize.control" /></button>
      </div>
      <button class="icon-button" v-if="closable" title="关闭" aria-label="关闭合并编辑器" @click="emit('close')"><X :size="iconSize.action" /></button>
    </div>
    <p v-if="error" class="merge-error" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="merge-empty">正在读取 {{ path }}…</p>
    <p v-else-if="!blocks.length" class="merge-empty">这个文件里没有冲突标记。</p>
    <template v-else>
      <div class="merge-toolbar">
        <button class="merge-btn" :disabled="busy || current < 0" :title="ACCEPT_LEFT_TEXT" @click="acceptOne('left')"><IdeaApplyLeftSideIcon aria-hidden="true" :size="iconSize.menu" />{{ ACCEPT_LEFT_TEXT }}</button>
        <button class="merge-btn" :disabled="busy || current < 0" :title="ACCEPT_RIGHT_TEXT" @click="acceptOne('right')"><IdeaApplyRightSideIcon aria-hidden="true" :size="iconSize.menu" />{{ ACCEPT_RIGHT_TEXT }}</button>
        <!-- 本仓扩展：上游没有这一档（见 src/mergeEditor.ts 文件头）。 -->
        <button class="merge-btn" :disabled="busy || current < 0" :title="ACCEPT_BOTH_NOTE" @click="acceptBothOne">{{ ACCEPT_BOTH_TEXT }}</button>
        <span class="merge-toolbar-sep" aria-hidden="true" />
        <button class="merge-btn" :disabled="busy" :title="`${ACCEPT_LEFT_TEXT}（整文件）`" @click="acceptWhole('left')">{{ ACCEPT_LEFT_TEXT }}（全部）</button>
        <button class="merge-btn" :disabled="busy" :title="`${ACCEPT_RIGHT_TEXT}（整文件）`" @click="acceptWhole('right')">{{ ACCEPT_RIGHT_TEXT }}（全部）</button>
        <span class="merge-toolbar-sep" aria-hidden="true" />
        <!-- 上游三方查看器读的就是索引三阶段；这里把真 blob 摆出来只读预览（接受/解决仍在上面）。 -->
        <button class="merge-btn" type="button" title="查看索引冲突三阶段（:1 基线 / :2 我们的 / :3 他们的）真内容" @click="stagesOpen = true">暂存内容…</button>
      </div>
      <div class="merge-columns" role="group" aria-label="三方合并">
        <div class="merge-column-title">{{ MERGE_TITLES.left }}</div>
        <div class="merge-column-title">{{ MERGE_TITLES.base }}<span v-if="!activeBlock?.hasBase" class="merge-note"> {{ NO_BASE_NOTE }}</span></div>
        <div class="merge-column-title">{{ MERGE_TITLES.right }}</div>
        <template v-for="(row, index) in model.rows" :key="index">
          <template v-if="row.kind === 'equal'">
            <div class="merge-cell merge-equal"><span class="merge-no">{{ row.left?.no ?? '' }}</span><span class="merge-text">{{ row.left?.text ?? '' }}</span></div>
            <div class="merge-cell merge-equal"><span class="merge-no">{{ row.base?.no ?? '' }}</span><span class="merge-text">{{ row.base?.text ?? '' }}</span></div>
            <div class="merge-cell merge-equal"><span class="merge-no">{{ row.right?.no ?? '' }}</span><span class="merge-text">{{ row.right?.text ?? '' }}</span></div>
          </template>
          <template v-else>
            <div class="merge-cell merge-conflict" :class="{ active: row.block === current }" @click="current = row.block">
              <span class="merge-no">{{ row.left?.no ?? '' }}</span><span class="merge-text">{{ row.left?.text ?? '' }}</span>
            </div>
            <div class="merge-cell merge-conflict" :class="{ active: row.block === current }" @click="current = row.block">
              <span class="merge-no">{{ row.base?.no ?? '' }}</span><span class="merge-text">{{ row.base?.text ?? '' }}</span>
            </div>
            <div class="merge-cell merge-conflict" :class="{ active: row.block === current }" @click="current = row.block">
              <span class="merge-no">{{ row.right?.no ?? '' }}</span><span class="merge-text">{{ row.right?.text ?? '' }}</span>
            </div>
          </template>
        </template>
      </div>
    </template>
    <!-- 三阶段真内容的只读预览（绝对定位盖在本编辑器之上；面板由 `.merge-editor { position: relative }` 定位）。 -->
    <RevisionCompareDialog v-if="stagesOpen" :path="path" stages @close="stagesOpen = false" />
  </div>
</template>

<style scoped>
/* 三栏网格：三列等宽（`MergeThreesideViewer` 的左/中/右三个编辑器）。
   `position: relative` 给「暂存内容…」那张绝对定位的预览面板做锚点（`RevisionCompareDialog` 的 inset:0）。 */
.merge-editor { position: relative; display: flex; flex-direction: column; min-height: 0; flex: 1; font-size: 12px; color: var(--text); }
.merge-head { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); }
.merge-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12px var(--font-mono); }
.merge-status { color: var(--muted); font-size: 11px; white-space: nowrap; }
.merge-auto { display: inline-flex; align-items: center; gap: 2px; color: var(--success); font-size: 11px; white-space: nowrap; }
.merge-nav { margin-left: auto; display: inline-flex; gap: var(--space-1); }
.merge-nav button:disabled { opacity: .4; cursor: default; }
.merge-error { margin: 0; padding: var(--space-1) var(--space-3); color: var(--error); font-size: 11px; }
.merge-empty { margin: 0; padding: var(--space-2) var(--space-3); color: var(--muted); font-size: 11px; }
.merge-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); }
.merge-btn { display: inline-flex; align-items: center; gap: var(--space-1); padding: 3px var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--elevated); color: var(--text); font-size: 11px; }
.merge-btn:hover:not(:disabled) { background: var(--hover); color: var(--bright); }
.merge-btn:disabled { color: var(--muted); opacity: .5; }
.merge-toolbar-sep { width: 1px; align-self: stretch; background: var(--line); margin: 0 var(--space-1); }
/* 三栏：标题行 + 内容行共用一个网格，`grid-template-columns: repeat(3, minmax(0, 1fr))`。 */
.merge-columns { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-content: start; font: 11px/1.7 var(--font-mono); }
.merge-column-title { position: sticky; top: 0; z-index: 1; padding: 2px var(--space-2); background: var(--panel); border-bottom: 1px solid var(--line-strong); color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-size: 10px; }
.merge-note { color: var(--muted); text-transform: none; letter-spacing: 0; font-size: 10px; }
.merge-cell { display: flex; gap: var(--space-1); min-width: 0; padding: 0 var(--space-2); border-right: 1px solid var(--line); }
.merge-no { flex-shrink: 0; width: 34px; text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; user-select: none; }
.merge-text { min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.merge-equal { background: var(--editor); }
/* 冲突块：左/中/右三格都染底（与 diff 的增/删底同一族令牌）。 */
.merge-conflict { background: var(--warning-bg); cursor: pointer; }
.merge-conflict.active { outline: 1px solid var(--accent); outline-offset: -1px; background: var(--selected); }
</style>