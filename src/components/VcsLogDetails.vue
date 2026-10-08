<script setup lang="ts">
import { Copy, GitPullRequestArrow } from 'lucide-vue-next'
import type { GitFullCommit, GitCommitDetails } from '../bridge'
import { formatDateTimeShort, type DateTimeFormatSettings } from '../dateTimeFormat.ts'
import { iconSize } from '../uiIcons'
const props = defineProps<{ commit: GitFullCommit | null; details: GitCommitDetails | null; busy: boolean; dateFormat?: DateTimeFormatSettings; loading?: boolean; error?: string }>()
const emit = defineEmits<{ copy: []; cherryPick: []; navigate: [hash: string] }>()
function dateText(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : formatDateTimeShort(date, props.dateFormat)
}
</script>
<template>
  <section class="detail" aria-label="提交详情">
    <template v-if="commit">
      <header class="vcslog-details-header"><span>{{ commit.shortHash }}</span>
        <button class="icon-button" title="复制完整哈希" aria-label="复制完整哈希" @click="emit('copy')"><Copy :size="iconSize.menu" /></button>
        <button class="icon-button" :disabled="busy" title="摘取该提交到当前分支（cherry-pick）" aria-label="摘取提交" @click="emit('cherryPick')"><GitPullRequestArrow :size="iconSize.menu" /></button>
      </header>
      <p v-if="loading" class="vcslog-details-note" role="status">正在加载详情…</p>
      <p v-if="error" class="vcslog-details-note" role="alert">{{ error }}</p>
      <div v-if="details" class="message">{{ details.message }}</div>
      <h3 v-else class="vcslog-details-subject">{{ commit.subject }}</h3>
      <dl class="vcslog-details-fields">
        <dt class="vcslog-details-field-label">作者</dt><dd class="vcslog-details-field-value">{{ commit.author }}<template v-if="details"> &lt;{{ details.authorEmail }}&gt;</template></dd>
        <dt class="vcslog-details-field-label">日期</dt><dd class="vcslog-details-field-value">{{ dateText(commit.date) }}</dd>
        <template v-if="details">
          <dt class="vcslog-details-field-label">提交者</dt><dd class="vcslog-details-field-value">{{ details.committer }} &lt;{{ details.committerEmail }}&gt;</dd>
          <dt class="vcslog-details-field-label">提交日期</dt><dd class="vcslog-details-field-value">{{ dateText(details.committerDate) }}</dd>
          <dt class="vcslog-details-field-label">所在分支</dt><dd class="vcslog-details-field-value">{{ details.containingBranches.join(', ') || '（无）' }}</dd>
        </template>
        <dt class="vcslog-details-field-label">提交</dt><dd class="vcslog-details-field-value mono">{{ commit.hash }}</dd>
        <dt class="vcslog-details-field-label">父提交</dt><dd class="vcslog-details-field-value"><template v-if="commit.parents.length"><button v-for="parent in commit.parents" :key="parent" class="parent mono" :title="parent" @click="emit('navigate', parent)">{{ parent.slice(0, 8) }}</button></template><template v-else>（根提交）</template></dd>
        <dt v-if="commit.refs.length" class="vcslog-details-field-label">引用</dt><dd v-if="commit.refs.length" class="vcslog-details-field-value">{{ commit.refs.map(r => r.name).join(', ') }}</dd>
      </dl>
    </template>
    <p v-else class="vcslog-details-note">选择提交以查看详情。</p>
  </section>
</template>
<style scoped>
.detail { flex: 1; min-height: 0; overflow: auto; padding: var(--space-2) var(--space-3); font-size: 11px; }
.vcslog-details-header { display: flex; align-items: center; gap: 6px; margin-bottom: var(--space-1); }
.vcslog-details-header span { margin-right: auto; color: var(--accent); font-family: var(--font-mono); }
.vcslog-details-subject { margin: 0 0 var(--space-2); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.vcslog-details-fields { display: grid; grid-template-columns: 50px 1fr; gap: var(--space-1) var(--space-2); margin: 0; }
.vcslog-details-field-label, .vcslog-details-note { color: var(--muted); }
.vcslog-details-field-value { margin: 0; overflow-wrap: anywhere; user-select: text; }
.message { white-space: pre-wrap; overflow-wrap: anywhere; margin-bottom: var(--space-3); user-select: text; line-height: 1.5; }
.mono { font: 10px var(--font-mono); }
.parent { color: var(--accent); border: 0; background: none; padding: 0; margin-right: var(--space-2); cursor: pointer; text-decoration: underline; }
</style>
