<script setup lang="ts">
// 助记键选择器（上游 `platform/bookmarks/src/com/intellij/ide/bookmark/actions/BookmarkTypeChooser.kt`）。
//
// 上游的形状：两块网格（先数字后字母，`mnemonic.isDigit()` / `isLetter()` 分栏，`:151-166`）、
// 一行说明（`mnemonic.chooser.comment`）、一个描述输入框（`mnemonic.chooser.description`）、
// 两个图例点（已使用 / 当前，`:205-222` 的三种底色），标题随状态变（`ChooseBookmarkTypeAction:31-41`）。
// 文案逐条取本机 IDEA 2026.2 中文包的 BookmarkBundle / ActionsBundle（添加助记书签… / 指定助记符… /
// 更改助记符… / 移除助记键 / 重写助记键之前询问）。
//
// 这个组件只做展示与键盘：状态与副作用都在 `src/bookmarkActions.ts`（宿主把事件转发过去）。
import { computed, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { BOOKMARK_MNEMONICS, type Bookmark } from '../bookmarks'
import { iconSize } from '../uiIcons'

/** 选择器的状态：正在给哪个位置贴助记键、它当前是什么、描述是什么。 */
export interface MnemonicPromptState { path: string; line: number; current?: string; description?: string }
/** "已被占用，是否重写"的询问态（上游 `BookmarksManagerImpl.canRewriteType:262-283`）。 */
export interface RewriteAskState { mnemonic: string; owner: Bookmark }

const props = defineProps<{
  prompt: MnemonicPromptState
  rewrite?: RewriteAskState | null
  /** 某个助记键被谁占着：占着就给 `文件:行`，空着给 `—`。 */
  ownerOf: (mnemonic: string) => string
  /** 焦点环（弹层内的 Tab 循环；宿主已有这一件，见 diskSync 的 trapFocus）。 */
  trapFocus: (event: KeyboardEvent) => void
}>()
const emit = defineEmits<{
  pick: [mnemonic: string, description: string]
  remove: []
  confirm: []
  dontAsk: []
  close: []
}>()

const digits = BOOKMARK_MNEMONICS.filter(key => key >= '0' && key <= '9')
const letters = BOOKMARK_MNEMONICS.filter(key => key > '9')
const description = ref('')
watch(() => props.prompt, prompt => { description.value = prompt.description ?? '' }, { immediate: true })

const title = computed(() => props.prompt.current === undefined ? '指定助记符…' : '更改助记符…')
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { emit('close'); return }
  props.trapFocus(event)
}
function stateOf(key: string) {
  if (props.prompt.current === key) return 'mnemonic-current'
  return props.ownerOf(key) === '—' ? '' : 'mnemonic-assigned'
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="mnemonic-pop" role="dialog" aria-modal="true" :aria-label="title" @keydown="onKeydown">
      <div class="palette-scope">{{ title }} · {{ prompt.path }}:{{ prompt.line }}</div>
      <p class="mnemonic-comment">快速设置：输入或双击助记键<br>提供备注：选择助记键，添加描述，然后按 Enter 键</p>
      <div class="mnemonic-columns">
        <div class="mnemonic-grid"><button v-for="key in digits" :key="key" :class="stateOf(key)" :title="ownerOf(key)" @click="emit('pick', key, description)"><kbd>{{ key }}</kbd><span>{{ ownerOf(key) }}</span></button></div>
        <div class="mnemonic-grid mnemonic-grid-letters"><button v-for="key in letters" :key="key" :class="stateOf(key)" :title="ownerOf(key)" @click="emit('pick', key, description)"><kbd>{{ key }}</kbd><span>{{ ownerOf(key) }}</span></button></div>
      </div>
      <input v-model="description" class="mnemonic-description" placeholder="描述(可选)" aria-label="书签描述（可选）" @keydown.enter.prevent="prompt.current !== undefined ? emit('pick', prompt.current, description) : undefined" />
      <div class="mnemonic-legend"><span class="mnemonic-dot assigned" />已使用<span class="mnemonic-dot current" />当前</div>
      <div v-if="rewrite" class="mnemonic-confirm" role="alertdialog" aria-label="重写助记键">
        <p>{{ rewrite.mnemonic }} 助记键已被占用（{{ rewrite.owner.path }}:{{ rewrite.owner.line }}）。是否要重写?</p>
        <div class="mnemonic-foot">
          <button class="subtle-button" @click="emit('confirm')">重写</button>
          <button class="subtle-button" @click="emit('dontAsk')">重写且不再询问</button>
          <button class="icon-button" aria-label="取消重写" @click="emit('close')">取消</button>
        </div>
      </div>
      <div v-else class="mnemonic-foot">
        <button v-if="prompt.current !== undefined" class="subtle-button" @click="emit('remove')">移除助记键</button>
        <button class="icon-button" title="关闭助记键选择" aria-label="关闭助记键选择" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
    </section>
  </div>
</template>
