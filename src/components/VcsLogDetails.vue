<script setup lang="ts">
import { Copy, GitPullRequestArrow } from 'lucide-vue-next'
import type { GitFullCommit, GitCommitDetails } from '../bridge'
import { logDate } from '../vcsLogGraph'
defineProps<{ commit: GitFullCommit | null; details: GitCommitDetails | null; busy: boolean; loading?: boolean; error?: string }>()
const emit = defineEmits<{ copy: []; cherryPick: []; navigate: [hash: string] }>()
</script>
<template>
  <section class="detail" aria-label="提交详情">
    <template v-if="commit">
      <header><span>{{ commit.shortHash }}</span>
        <button class="icon-button" title="复制完整哈希" aria-label="复制完整哈希" @click="emit('copy')"><Copy :size="13" /></button>
        <button class="icon-button" :disabled="busy" title="摘取该提交到当前分支（cherry-pick）" aria-label="摘取提交" @click="emit('cherryPick')"><GitPullRequestArrow :size="13" /></button>
      </header>
      <p v-if="loading" role="status">正在加载详情…</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <div v-if="details" class="message">{{ details.message }}</div>
      <h3 v-else>{{ commit.subject }}</h3>
      <dl>
        <dt>作者</dt><dd>{{ commit.author }}<template v-if="details"> &lt;{{ details.authorEmail }}&gt;</template></dd>
        <dt>日期</dt><dd>{{ logDate(commit.date) }}</dd>
        <template v-if="details">
          <dt>提交者</dt><dd>{{ details.committer }} &lt;{{ details.committerEmail }}&gt;</dd>
          <dt>提交日期</dt><dd>{{ logDate(details.committerDate) }}</dd>
          <dt>所在分支</dt><dd>{{ details.containingBranches.join(', ') || '（无）' }}</dd>
        </template>
        <dt>提交</dt><dd class="mono">{{ commit.hash }}</dd>
        <dt>父提交</dt><dd><template v-if="commit.parents.length"><button v-for="parent in commit.parents" :key="parent" class="parent mono" :title="parent" @click="emit('navigate', parent)">{{ parent.slice(0, 8) }}</button></template><template v-else>（根提交）</template></dd>
        <dt v-if="commit.refs.length">引用</dt><dd v-if="commit.refs.length">{{ commit.refs.map(r => r.name).join(', ') }}</dd>
      </dl>
    </template>
    <p v-else>选择提交以查看详情。</p>
  </section>
</template>
<style scoped>
.detail { flex: 1; min-height: 0; overflow: auto; padding: 8px 12px; font-size: 11px; }
header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
header span { margin-right: auto; color: var(--accent); font-family: var(--font-mono); }
h3 { margin: 0 0 8px; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
dl { display: grid; grid-template-columns: 50px 1fr; gap: 4px 8px; margin: 0; }
dt, p { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; user-select: text; }
.message { white-space: pre-wrap; overflow-wrap: anywhere; margin-bottom: 12px; user-select: text; line-height: 1.5; }
.mono { font: 10px var(--font-mono); }
.parent { color: var(--accent); border: 0; background: none; padding: 0; margin-right: 8px; cursor: pointer; text-decoration: underline; }
</style>
