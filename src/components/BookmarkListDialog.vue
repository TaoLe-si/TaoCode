<script setup lang="ts">
// 书签列表的对话框（上游三个合一的形状）：`GroupCreateDialog` / `GroupRenameDialog` /
// `GroupSelectDialog` 都继承 `ui/BookmarkRenameDialog.kt`（一个输入框 + 一个「用作默认列表」勾选 +
// 帮助提示），删除走 `Messages.showYesNoDialog`（文案见下）。文案逐条取本机 IDEA 2026.2 中文包：
//   创建：标题「创建书签列表」/ 按钮「创建」      改名：标题「重命名书签列表」/ 按钮「重命名」
//   选择：标题「选择书签列表」/ 按钮「选择」      删除：标题「删除书签列表」/
//   「确定要删除 ''{0}'' 书签列表吗? 此操作无法撤消。」
//   输入框标签「书签列表:」、预填名「新建列表」、重名提示「名称已存在」
import { computed, ref, watch } from 'vue'
import { listDialog, listNameIssue, namedListNames, confirmDeleteList, finishListDialog } from '../bookmarkListActions.ts'

const value = ref('')

const mode = computed(() => listDialog.value?.mode ?? 'create')
const title = computed(() => mode.value === 'rename' ? '重命名书签列表'
  : mode.value === 'select' ? '选择书签列表'
  : mode.value === 'delete' ? '删除书签列表' : '创建书签列表')
const confirmLabel = computed(() => mode.value === 'rename' ? '重命名' : mode.value === 'select' ? '选择' : '创建')
const issue = computed(() => (mode.value === 'delete' || mode.value === 'select' ? '' : listNameIssue(value.value, listDialog.value?.name)))
const deleting = computed(() => mode.value === 'delete')

watch(listDialog, dialog => {
  if (!dialog) return
  if (dialog.mode === 'create') value.value = '新建列表'
  else if (dialog.mode === 'rename') value.value = dialog.name ?? ''
  else value.value = ''
}, { immediate: true })

function confirm() {
  if (deleting.value) { confirmDeleteList(); return }
  if (!value.value.trim() || issue.value) return
  finishListDialog(value.value)
}
</script>

<template>
  <div class="modal-backdrop" @click.self="listDialog = null">
    <section class="help-dialog rename-dialog bookmark-list-dialog" role="dialog" aria-modal="true" :aria-label="title">
      <h2>{{ title }}</h2>
      <template v-if="deleting">
        <p class="rename-target">确定要删除 ''{{ listDialog?.name }}'' 书签列表吗? 此操作无法撤消。</p>
      </template>
      <template v-else-if="mode === 'select'">
        <p class="rename-target">把这条书签加到哪个列表？</p>
        <div class="bookmark-list-choices">
          <button v-for="name in namedListNames" :key="name" class="subtle-button" @click="finishListDialog(name)">{{ name }}</button>
        </div>
      </template>
      <template v-else>
        <p class="rename-target">书签列表:</p>
        <input v-model="value" class="rename-input" aria-label="书签列表名" placeholder="新建列表" spellcheck="false"
               :aria-invalid="Boolean(issue)" @keydown.enter.prevent="confirm" />
        <p v-if="issue" class="rename-note" style="color: var(--error)">{{ issue }}</p>
      </template>
      <div v-if="!deleting && mode !== 'select'" class="dialog-actions">
        <button class="primary-button" :disabled="!value.trim() || Boolean(issue)" @click="confirm">{{ confirmLabel }}</button>
        <button class="subtle-button" @click="listDialog = null">取消</button>
      </div>
      <div v-else class="dialog-actions">
        <button v-if="deleting" class="primary-button" @click="confirm">删除</button>
        <button class="subtle-button" @click="listDialog = null">取消</button>
      </div>
    </section>
  </div>
</template>
