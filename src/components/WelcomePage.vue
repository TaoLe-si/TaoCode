<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { CircleHelp, FolderOpen, FolderPlus, GitBranch, RefreshCw, Search, Settings, X } from 'lucide-vue-next'
import type { RecentProject } from '../bridge'

const props = defineProps<{
  projects: RecentProject[]
  busy: boolean
  error: string
  gitAvailable: boolean
  isDesktop: boolean
}>()
const emit = defineEmits<{
  open: [path?: string]
  create: []
  clone: []
  settings: []
  forget: [path: string]
  refresh: []
  help: []
}>()

const id = useId()
const query = ref('')
const searchInput = ref<HTMLInputElement>()
const filteredProjects = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return props.projects.filter(project => `${project.name}\n${project.path}`.toLocaleLowerCase().includes(needle))
})
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})
function openedDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : dateFormat.format(date)
}
function avatarTone(path: string) {
  return [...path].reduce((sum, character) => sum + character.codePointAt(0)!, 0) % 3
}
function clearSearch() {
  query.value = ''
  searchInput.value?.focus()
}
</script>

<template>
  <div class="project-welcome">
    <aside class="welcome-sidebar">
      <div class="welcome-brand">
        <div class="brand">TaoCode</div>
        <span class="welcome-version">0.1</span>
      </div>
      <nav class="welcome-navigation" aria-label="欢迎页导航">
        <button type="button" class="menu-button navigation-item selected" aria-current="page" @click="searchInput?.focus()">
          <FolderOpen :size="17" aria-hidden="true" />项目
        </button>
        <button type="button" class="menu-button navigation-item" :disabled="busy" @click="emit('settings')">
          <Settings :size="17" aria-hidden="true" />设置
        </button>
        <button type="button" class="menu-button navigation-item" :disabled="busy" @click="emit('help')">
          <CircleHelp :size="17" aria-hidden="true" />关于
        </button>
      </nav>
      <p class="sidebar-note">{{ isDesktop ? '本地项目' : '浏览器 · 内存预览' }}</p>
    </aside>

    <main class="welcome-main" :aria-labelledby="`${id}-title`">
      <div class="welcome-content">
        <header class="welcome-heading">
          <h1 :id="`${id}-title`">项目</h1>
          <div class="project-actions" aria-label="项目操作">
            <button type="button" class="primary-button" :disabled="busy" @click="emit('create')">
              <FolderPlus :size="16" aria-hidden="true" />新建项目
            </button>
            <button type="button" class="subtle-button action-button" :disabled="busy" @click="emit('open')">
              <FolderOpen :size="16" aria-hidden="true" />{{ isDesktop ? '打开项目' : '打开内存示例' }}
            </button>
            <button
              type="button" class="subtle-button action-button" :disabled="busy"
              :aria-describedby="!gitAvailable ? `${id}-git-note` : undefined" @click="emit('clone')"
            >
              <GitBranch :size="16" aria-hidden="true" />克隆仓库
            </button>
          </div>
        </header>

        <p v-if="!isDesktop" class="preview-banner welcome-preview">
          <span class="preview-dot" aria-hidden="true" />
          <span><strong>浏览器预览</strong>：此界面与示例文件仅在内存中运行，不访问磁盘，不能真实新建或克隆项目。新建和克隆表单仅供布局预览。</span>
        </p>
        <p v-if="!gitAvailable" :id="`${id}-git-note`" class="git-note">安装 Git 后才能克隆仓库；可以打开克隆表单查看说明。</p>
        <div v-if="error" class="notice error welcome-error" role="alert"><span>{{ error }}</span></div>

        <section class="recent-section" :aria-labelledby="`${id}-recent-title`" :aria-busy="busy">
          <div class="recent-heading">
            <h2 :id="`${id}-recent-title`">{{ isDesktop ? '近期项目' : '当前会话项目（内存）' }}</h2>
            <button type="button" class="icon-button" :disabled="busy" title="刷新项目列表" aria-label="刷新项目列表" @click="emit('refresh')">
              <RefreshCw :size="15" aria-hidden="true" />
            </button>
          </div>
          <div class="project-search">
            <Search :size="16" aria-hidden="true" />
            <input :id="`${id}-search`" ref="searchInput" v-model="query" type="search" aria-label="按项目名称或路径搜索" placeholder="搜索项目名称或路径" autocomplete="off" spellcheck="false" />
            <button v-if="query" type="button" class="icon-button" title="清空搜索" aria-label="清空搜索" @click="clearSearch"><X :size="15" aria-hidden="true" /></button>
          </div>
          <p class="list-status" role="status">{{ busy ? '正在处理项目操作…' : query.trim() ? `找到 ${filteredProjects.length} 个项目` : `${projects.length} 个项目` }}</p>

          <ul v-if="filteredProjects.length" class="recent-list">
            <li v-for="project in filteredProjects" :key="project.path" class="recent-row">
              <button
                type="button" class="recent-open" :disabled="busy || !project.available"
                :title="project.available ? `打开 ${project.path}` : `路径不存在或不可访问：${project.path}`"
                @click="emit('open', project.path)"
              >
                <span class="project-avatar" :class="`avatar-${avatarTone(project.path)}`" aria-hidden="true">{{ [...project.name.trim()][0]?.toLocaleUpperCase() || '项' }}</span>
                <span class="project-details">
                  <span class="project-title"><strong>{{ project.name }}</strong><span v-if="!isDesktop" class="memory-tag">内存示例</span></span>
                  <span class="project-path" :title="project.path">{{ project.path }}</span>
                  <span class="project-date">最近打开：<time>{{ openedDate(project.lastOpened) }}</time></span>
                </span>
              </button>
              <div class="recent-row-actions">
                <span v-if="!project.available" class="missing-tag">{{ isDesktop ? '路径缺失或不可访问' : '示例不可用' }}</span>
                <button
                  type="button" class="menu-button forget-button" :disabled="busy"
                  :aria-label="`仅从列表移除 ${project.name}，不删除文件`" title="仅移除记录，不删除文件"
                  @click="emit('forget', project.path)"
                ><X :size="13" aria-hidden="true" />仅从列表移除</button>
              </div>
            </li>
          </ul>
          <div v-else-if="query.trim()" class="project-empty">
            <Search :size="28" aria-hidden="true" />
            <h3>没有匹配的项目</h3>
            <p>试试其他名称或路径，或清空搜索查看全部项目。</p>
            <button type="button" class="subtle-button" @click="clearSearch">清空搜索</button>
          </div>
          <div v-else class="project-empty">
            <FolderOpen :size="30" aria-hidden="true" />
            <h3>{{ isDesktop ? '还没有近期项目' : '尚未打开内存示例' }}</h3>
            <p>{{ isDesktop ? '点击“打开项目”选择已有文件夹，或点击“新建项目”创建 Java 项目或空项目。' : '点击“打开内存示例”体验编辑。真实的打开、新建和克隆需要在桌面端操作。' }}</p>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.project-welcome { display: grid; grid-template-columns: 210px minmax(0, 1fr); flex: 1; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: var(--editor); }
.welcome-sidebar { display: flex; flex-direction: column; gap: var(--space-5); min-height: 0; overflow: auto; padding: var(--space-6) var(--space-3) var(--space-4); background: var(--panel); border-right: 1px solid var(--line); }
.welcome-brand { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--space-2); padding: 0 var(--space-3); }
.welcome-brand .brand { font-size: 20px; gap: var(--space-2); }
.welcome-version { font: 11px var(--font-mono); color: var(--muted); }
.welcome-navigation { display: flex; flex-direction: column; gap: var(--space-1); }
.navigation-item { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: var(--ctrl-height-lg); padding: var(--space-1) var(--space-3); border-radius: var(--radius-xs); text-align: left; font-size: 13px; }
.navigation-item.selected { background: var(--selected); color: var(--bright); font-weight: 600; }
.navigation-item > svg { flex-shrink: 0; }
.sidebar-note { margin: auto var(--space-3) 0; color: var(--muted); font-size: 11px; }
.welcome-main { min-width: 0; min-height: 0; overflow: auto; }
.welcome-content { width: 100%; max-width: 1050px; margin: 0 auto; padding: clamp(24px, 5vw, 64px); }
.welcome-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-5); margin-bottom: var(--space-5); padding-bottom: var(--space-4); border-bottom: 1px solid var(--line); }
.welcome-heading h1 { margin: 0; font-size: 24px; line-height: 1.4; font-weight: 600; color: var(--bright); }
.project-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.project-actions .primary-button { margin-top: 0; }
.action-button { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: var(--ctrl-height-lg); }
.action-button > svg { flex-shrink: 0; }
.welcome-preview { align-items: flex-start; gap: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-xs); padding: var(--space-2) var(--space-3); margin: 0 0 var(--space-3); font-size: 12px; }
.welcome-preview .preview-dot { margin-top: var(--space-2); }
.welcome-preview > span:last-child { min-width: 0; overflow-wrap: anywhere; }
.git-note { margin: 0 0 var(--space-3); color: var(--muted); }
.welcome-error { border: 1px solid var(--error); border-radius: var(--radius-xs); margin-bottom: var(--space-3); }
.recent-section { min-width: 0; }
.recent-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-2); }
.recent-heading h2 { margin: 0; color: var(--muted); font-size: 11px; font-weight: 500; letter-spacing: .03em; }
.project-search { display: flex; align-items: center; gap: var(--space-2); min-width: 0; padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3); min-height: 36px; background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--muted); }
.project-search:focus-within { border-color: var(--accent); }
.project-search > svg { flex-shrink: 0; }
.project-search input { flex: 1; width: 100%; min-width: 0; padding: var(--space-1); border: 0; background: var(--editor); color: var(--text); }
.project-search input::placeholder { color: var(--muted); }
.project-search input::-webkit-search-cancel-button { display: none; }
.list-status { margin: var(--space-2) 0 var(--space-1); color: var(--muted); font: 11px var(--font-mono); font-variant-numeric: tabular-nums; }
.recent-list { list-style: none; margin: 0; padding: 0; }
.recent-row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; padding: 3px 0; border-bottom: 1px solid var(--line); }
.recent-open { display: grid; align-items: center; grid-template-columns: 26px minmax(11rem, 26%) minmax(0, 1fr) auto; gap: var(--space-1) var(--space-3); align-items: baseline; flex: 1; min-width: 0; padding: var(--space-1) var(--space-2); border: 0; border-radius: var(--radius-xs); background: var(--editor); text-align: left; }
.recent-open:hover:not(:disabled) { background: var(--hover); }
.recent-open:disabled { opacity: 1; color: var(--muted); }
.project-avatar { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; flex-shrink: 0; align-self: center; border-radius: var(--radius-sm); background: var(--selected); color: var(--accent); font: 600 12px var(--font-brand); }
.avatar-1 { color: var(--syntax-keyword); background: var(--panel); }
.avatar-2 { color: var(--syntax-type); background: var(--rail); }
.project-details { display: contents; }
.project-title { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0; white-space: nowrap; }
.project-title strong { min-width: 0; color: var(--bright); font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-path { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--secondary); font: 11px/1.6 var(--font-mono); font-variant-numeric: tabular-nums; }
.project-date { color: var(--muted); font: 11px var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.memory-tag { flex-shrink: 0; color: var(--warning); font-size: 10px; }
.recent-row-actions { display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-1); flex-shrink: 0; }
.missing-tag { padding: 2px var(--space-1); border-radius: var(--radius-xs); color: var(--warning); background: var(--warning-bg); font-size: 10px; }
.forget-button { display: inline-flex; align-items: center; gap: var(--space-1); border-radius: var(--radius-xs); font-size: 11px; }
.project-empty { padding: 42px var(--space-3); text-align: center; color: var(--muted); }
.project-empty h3 { margin: var(--space-3) 0 var(--space-2); font-size: 15px; color: var(--text); font-weight: 500; }
.project-empty p { max-width: 430px; margin: 0 auto var(--space-4); line-height: 1.8; overflow-wrap: anywhere; }
@media (max-width: 760px) {
  .project-welcome { grid-template-columns: 155px minmax(0, 1fr); }
  .welcome-sidebar { padding: var(--space-5) var(--space-2) var(--space-4); }
  .welcome-brand { gap: var(--space-1); padding: 0 var(--space-2); }
  .welcome-brand .brand { font-size: 17px; }
  .welcome-content { padding: var(--space-5) var(--space-5); }
  .recent-row { flex-wrap: wrap; }
  .recent-open { flex-basis: 100%; grid-template-columns: 24px minmax(0, 1fr); align-items: center; }
  .project-details { display: flex; flex-direction: column; gap: 2px; }
  .project-avatar { grid-row: auto; }
  .project-date { font-family: var(--font-ui); }
  .recent-row-actions { flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: flex-end; width: 100%; }
}
@media (max-width: 480px) {
  .project-welcome { grid-template-columns: 105px minmax(0, 1fr); }
  .welcome-sidebar { gap: var(--space-5); padding: var(--space-5) var(--space-1) var(--space-3); }
  .welcome-brand { padding: 0 var(--space-1); }
  .welcome-brand .brand { gap: var(--space-1); font-size: 13px; }
  .navigation-item { padding: var(--space-2); gap: var(--space-2); }
  .sidebar-note { margin-inline: var(--space-2); }
  .welcome-content { padding: var(--space-5) var(--space-3); }
  .welcome-heading { margin-bottom: var(--space-5); gap: var(--space-3); }
  .welcome-heading h1 { font-size: 21px; }
  .project-actions { flex-direction: column; align-items: stretch; width: 100%; }
  .project-actions .primary-button { justify-content: center; }
  .recent-open { gap: var(--space-2); padding-inline: 0; }
  .project-avatar { width: 30px; height: 32px; font-size: 16px; }
}
</style>
