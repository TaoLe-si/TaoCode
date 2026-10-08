<script setup lang="ts">
// 「与本地比较」（上游 `CompareWithLocalDialog`，
// `platform/vcs-impl/src/com/intellij/vcs/CompareWithLocalDialog.java:53-55`）与
// 「三方暂存内容」（上游三方合并 `ThreesideMergeRequest.getContents()` 的 stage1/2/3）的共同宿主。
//
// 两种模式共用一个组件，是因为它们只差"取几条内容、摆几栏"：
//   · `revision` 给定 ⇒ 两栏：该修订该文件（左） ↔ 工作区版本（右）。取数在
//     `src/revisionContent.ts` 的 `loadRevisionFile`，规则与补丁文本在 `src/compareWithLocal.ts`，
//     渲染直接复用 `DiffView.vue`（与 Git 变更视图同一个差分渲染器，两处判决不会分叉）；
//   · `stages` 为真 ⇒ 三栏：索引冲突三阶段的**真 blob**（`:1:` 基线 / `:2:` 我们的 / `:3:` 他们的），
//     由 `loadMergeStages` 读。缺哪一阶段就那一栏如实写"此阶段不存在"，不拿别的阶段顶替。
//
// 这一条是上一轮判词里"缺通道"的收口：`src/bridge.ts`/`native/main.cpp` 未新增 git 方法，
// 复用现有 `git.showCommit` 的 `<rev>:<path>` / `:<n>:<path>` 说明符（真仓已核，见模块头）。
import { computed, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { request } from '../bridge'
import DiffView from './DiffView.vue'
import { iconSize } from '../uiIcons'
import { compareWithLocalTitle, compareWithLocalSides, LOCAL_SIDE_LABEL, revisionSideLabel } from '../compareWithLocal'
import { loadMergeStages, loadRevisionFile, MERGE_STAGE_TITLES, type MergeStage } from '../revisionContent'

const props = defineProps<{
  /** 要比的文件（工作区相对 '/'）。 */
  path: string
  /** 两栏模式：拿这个修订的该文件与工作区对照（如分支名 / 提交号）。 */
  revision?: string
  /** 三栏模式：读索引冲突三阶段 `:1:`/`:2:`/`:3:` 的真内容。 */
  stages?: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const loading = ref(false)
const error = ref('')
/** 修订侧读不到内容（该修订里没有这个文件）—— 与"读取出错"是两回事，如实分开报。 */
const revisionMissing = ref(false)
const localText = ref('')
const revisionText = ref('')
interface StagePane { stage: MergeStage; title: string; available: boolean; content: string }
const stagePanes = ref<StagePane[]>([])

const title = computed(() => (props.stages
  ? `三方暂存内容：${props.path}`
  : compareWithLocalTitle(props.path, props.revision ?? '')))
const sides = computed(() => compareWithLocalSides(revisionText.value, localText.value))
const subtitle = computed(() => (props.stages
  ? '索引冲突三阶段（:1 基线 / :2 我们的 / :3 他们的）'
  : `${revisionSideLabel(props.revision ?? '')} ↔ ${LOCAL_SIDE_LABEL}`))
function errorText(caught: unknown) { return caught instanceof Error ? caught.message : String(caught) }

async function load() {
  loading.value = true
  error.value = ''
  revisionMissing.value = false
  stagePanes.value = []
  try {
    if (props.stages) {
      const stages = await loadMergeStages(props.path)
      stagePanes.value = (Object.entries(stages) as [keyof typeof stages, { available: boolean; content: string }][])
        .map(([, file], index) => ({
          stage: (index + 1) as MergeStage,
          title: MERGE_STAGE_TITLES[(index + 1) as MergeStage],
          available: file.available,
          content: file.content,
        }))
        .filter(pane => pane.stage >= 1)
    } else {
      const [remote, local] = await Promise.all([
        loadRevisionFile(props.revision ?? '', props.path),
        request<{ content: string }>('file.read', { path: props.path }),
      ])
      revisionMissing.value = !remote.available
      revisionText.value = remote.content
      localText.value = local.content ?? ''
    }
  } catch (caught) { error.value = errorText(caught) }
  finally { loading.value = false }
}
watch(() => [props.path, props.revision, props.stages] as const, () => { void load() }, { immediate: true })
</script>

<template>
  <div class="rc-dialog" role="dialog" aria-modal="true" :aria-label="title">
    <div class="rc-head">
      <span class="rc-title">{{ title }}</span>
      <span v-if="subtitle" class="rc-subtitle">{{ subtitle }}</span>
      <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" /></button>
    </div>
    <p v-if="error" class="rc-error" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="rc-note">正在读取…</p>
    <!-- 两栏模式：复用 DiffView（同一个差分渲染器 + 同一个忽略/高亮档选择器）。 -->
    <template v-else-if="!stages">
      <p v-if="revisionMissing" class="rc-note" role="status">这个修订里没有「{{ path }}」—— 左栏留空（不拿工作区内容冒充）。</p>
      <DiffView
        v-if="sides.available" closable :path="path" :subtitle="subtitle"
        :rows="sides.rows" :unified="sides.unified" :truncated="sides.truncated"
        :left-text="revisionText" :right-text="localText" @close="emit('close')"
      />
      <p v-else class="rc-note">两侧都没有内容。</p>
    </template>
    <!-- 三栏模式：三阶段的**真内容**（只读预览；接受/解决那些动作仍在 MergeEditor 里做）。 -->
    <div v-else class="rc-stages" role="group" aria-label="索引冲突三阶段">
      <div v-for="pane in stagePanes" :key="pane.stage" class="rc-stage">
        <div class="rc-stage-title">{{ pane.title }}（:{{ pane.stage }}:）</div>
        <pre v-if="pane.available" class="rc-stage-body">{{ pane.content }}</pre>
        <p v-else class="rc-note">此阶段不存在（这个文件现在不是待解决冲突，或该阶段为空）。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rc-dialog { position: absolute; inset: 0; z-index: 40; display: flex; flex-direction: column; min-height: 0; background: var(--panel); border-left: 1px solid var(--line); }
.rc-head { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); }
.rc-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12px var(--font-mono); color: var(--text); }
.rc-subtitle { color: var(--muted); font-size: 11px; white-space: nowrap; }
.rc-head .icon-button { margin-left: auto; }
.rc-error { margin: 0; padding: var(--space-1) var(--space-3); color: var(--error); font-size: 11px; overflow-wrap: anywhere; }
.rc-note { margin: 0; padding: var(--space-2) var(--space-3); color: var(--muted); font-size: 11px; }
.rc-stages { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-content: start; }
.rc-stage { display: flex; flex-direction: column; min-width: 0; border-right: 1px solid var(--line); }
.rc-stage-title { position: sticky; top: 0; padding: 2px var(--space-2); background: var(--panel); border-bottom: 1px solid var(--line-strong); color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
.rc-stage-body { margin: 0; padding: var(--space-1) var(--space-2); font: 11px/1.6 var(--font-mono); color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
