<script setup lang="ts">
// 「转到哈希/分支/标记」—— 日志工具条右角的查找框（上游 `Vcs.Log.GoToRef`）。
// 模型与判据在 `src/vcsLogGoToRef.ts`：动作与弹层 = `GoToHashOrRefAction` + `GoToHashOrRefPopup`，
// 补全的两批 = `VcsRefCompletionProvider.java:26-38`（分支先出、标签这一半后台取回后追加）。
import { computed, ref, watch } from 'vue'
import { Search } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import type { GitFullCommit } from '../bridge'
import { GO_TO_REF_DESCRIPTION, GO_TO_REF_PROMPT, GO_TO_REF_TITLE,
  goToRefAccepts, goToRefCandidates, looksLikeHash, notAHashMessage, runRefCompletion } from '../vcsLogGoToRef'

const props = defineProps<{
  commits: readonly GitFullCommit[]
  navigating?: boolean
  /**
   * 两批候选的来源：分支 = 上游 `collectSync` 那一半、标签 = `collectAsync` 那一半。
   * **宿主没给就退回"已加载这一页的引用"** —— 与本文件接这两个 prop 之前的行为逐字一致，
   * 也不许在组件里自己发请求或编一份候选。
   */
  loadBranches?: () => Promise<readonly string[]>
  loadTags?: () => Promise<readonly string[]>
}>()
const emit = defineEmits<{ goTo: [hash: string] }>()
const open = ref(false)
const text = ref('')
/** 只在真的按了「转到」之后才判形状错 —— 找不到目标由 `navigate()` 的错误行报，不在这里猜。 */
const problem = ref('')
/** 已加载页上的引用：不等待的那一份，也是宿主没接两批来源时的唯一候选。 */
const pageRefs = computed(() => goToRefCandidates(props.commits))
/** 这一轮累积的全部候选（「转到」那一半按它判"这个名字认不认"，看的不是截过上限的那几条）。 */
const known = ref<string[]>([])
const matches = ref<string[]>([])
// 取消令牌：改一个字、关一次弹层都把上一轮作废（上游 `ProgressManager.checkCanceled()` +
// `future.cancel(true)`，`TwoStepCompletionProvider.java:44`/`:60-62`）—— 迟到的那一批不许盖到新的一轮上。
let round = 0
watch(pageRefs, refs => { known.value = [...new Set([...refs, ...known.value])] }, { immediate: true })
async function refresh() {
  const token = ++round
  const isStale = () => token !== round
  await runRefCompletion({
    prefix: text.value, sync: known.value, isStale,
    loadBranches: props.loadBranches, loadTags: props.loadTags,
    emit: (found, all) => { if (isStale()) return; matches.value = found; if (problem.value && goToRefAccepts(all, text.value)) problem.value = '' },
  })
}
// 每敲一个字重跑一轮（上游是补全结果集重算；本仓的来源是两次 await，所以要有上面那个令牌）。
watch(text, () => { if (open.value) void refresh() })
watch(open, value => { if (value) void refresh(); else round++ })
function choose(value: string) {
  const target = value.trim()
  if (!target) return
  round++
  open.value = false
  text.value = ''
  problem.value = ''
  emit('goTo', target)
}
/**
 * `VcsLogNavigationUtil.jumpToRefOrHash`（`:124-149`）的顺序：**先当引用**（名字前缀命中
 * 哪个引用就跳那个），再当**哈希**（`jumpToHash`，`:166-172` 判形状）。
 * 所以只有「既不是引用、形状也不像哈希」才是形状错。
 */
function submit() {
  const target = text.value.trim()
  if (!target) return
  if (!goToRefAccepts(known.value, target) && !looksLikeHash(target)) {
    problem.value = notAHashMessage(target)
    return
  }
  choose(target)
}
</script>

<template>
  <div class="go-to-ref">
    <button class="icon-button" :title="`${GO_TO_REF_TITLE}（${GO_TO_REF_DESCRIPTION}）`" :aria-label="GO_TO_REF_TITLE"
      :aria-expanded="open" :disabled="navigating" @click="open = !open">
      <Search :size="iconSize.control" />
    </button>
    <form v-if="open" class="popup" @submit.prevent="submit">
      <label class="prompt" for="vcslog-go-to-ref">{{ GO_TO_REF_PROMPT }}</label>
      <input id="vcslog-go-to-ref" v-model="text" :placeholder="GO_TO_REF_TITLE" autocomplete="off" spellcheck="false" />
      <ul v-if="matches.length" class="matches" role="listbox" aria-label="引用补全">
        <li v-for="name in matches" :key="name">
          <button type="button" role="option" :aria-selected="false" @click="choose(name)">{{ name }}</button>
        </li>
      </ul>
      <p v-if="problem" class="problem" role="alert">{{ problem }}</p>
      <div class="actions">
        <button type="button" @click="open = false">关闭</button>
        <button type="submit" :disabled="!text.trim()">转到</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.go-to-ref { position: relative; flex-shrink: 0; }
.popup { position: absolute; top: 29px; right: 0; z-index: 6; width: min(320px, calc(100vw - 40px)); padding: 12px; display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--line); background: var(--panel); box-shadow: var(--shadow-3); }
.prompt { color: var(--muted); font-size: 11px; }
input { min-width: 0; padding: 2px 4px; min-height: 22px; background: var(--editor); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius-xs); font: 11px/1.5 var(--font-ui); }
.matches { margin: 0; padding: 0; max-height: 160px; overflow: auto; list-style: none; border: 1px solid var(--line); }
.matches button { display: block; width: 100%; padding: 3px 6px; text-align: left; color: var(--text); background: none; border: 0; font-size: 11px; }
.matches button:hover { background: var(--hover); }
.problem { margin: 0; color: var(--error); font-size: 11px; overflow-wrap: anywhere; }
.actions { display: flex; justify-content: space-between; }
.actions button { background: var(--editor); color: var(--text); border: 1px solid var(--line); padding: 3px 8px; font-size: 11px; }
</style>
