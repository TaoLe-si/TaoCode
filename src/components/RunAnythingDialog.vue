<script setup lang="ts">
// Run Anything 弹层 —— 上游 `RunAnythingAction`/`RunAnythingPopupUI`（`platform/lang-impl/src/com/intellij/ide/actions/runAnything/`）的
// 对应物。候选装配/分组/历史在 src/runAnything.ts；这里只做输入、键盘导航与派发：
//   · 选运行配置 → App 走 `selectRunConfig` + `runSelectedConfig`（与 Run 菜单同一条链）；
//   · 命令行行 → App 走 `runExternalTool`（run.start 通道），并带上**执行上下文**那一格算出的工作目录。
// 输入框是多行编辑器（上游 `RunAnythingPopupUI` 的 `Shift+Enter` 插换行）：多行命令照原样
// 传给 shell（cmd 换行即命令分隔，见 native/run_host.cpp 的 cmd /c 通道），列表里按
// 上游 `RunAnythingCommandFolding` 的占位写法只显示第一行 + 行数。
//
// 「执行上下文」那一格 = 上游 `RunAnythingChooseContextAction.kt`：它是弹层**头部输入框右边**的一格
// （`RunAnythingPopupUI.java:796-847` 把 `myChooseContextAction` 装进 `createHeader()` 的那一行），
// 按钮文字 = 选中项的 label（`:76`），tooltip = `run.anything.context.tooltip`（`:58`），
// 点开的那张表标题 = `run.anything.context.title.working.directory`（`:214`）。
// 规则全在 src/runAnythingContext.ts（候选装配 `:119`、选择/隐藏 `:160`、目录折算 `:80`），这里只接 UI：
//   · 模块这一档的目录由宿主的 `moduleRoots` 给（模块名 → 工作区相对内容根，对应上游 `ModuleContext`
//     的 `guessModuleDir()`，`RunAnythingContextUtils.kt:18`）；本仓的来源是 **Gradle 子工程树**
//     （`src/runAnythingContext.ts` 的 `gradleSubprojectRoots`，App.vue 传 `:module-roots`）；
//     除了模块根，「第二档」还有两个真来源：**最近目录**那几档（`src/runAnythingRecentDirectories.ts`，
//     随项目读回来）与桌面端的「浏览目录…」动作行 ⇒ 表里只要除了项目档还有别的一格就有意义；
//     三样都没有（浏览器预览 + 没模块 + 没缓存）就**整格不渲染**（playbook §3「不放假控件」，
//     同上游 `update()` 的「没有可用上下文就隐藏」`:65-68` 与「模块只有一个就整组不列」`:247`）；
//   · **没选 = 不传 cwd** ⇒ `src/runActions.ts:515` 的 `cwd?.trim() || workspace.value.root` 在工作区根跑。
//     这与上游同结果：默认取表里第一档 `ProjectContext`（`activity/RunAnythingProvider.java:160`
//     「The first context will be chosen as default context」、`RunAnythingChooseContextAction.kt:73`），
//     它的 `getPath()` 就是项目根（`RunAnythingContextUtils.kt:15-17`），而本仓项目根的空串口径
//     见 `runAnythingContext.ts:80`；
//   · 只有**命令行**那一支吃这个目录：上游选运行配置时 provider 给的上下文表是空的
//     （`platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingRunConfigurationProvider.java:56-58`
//     的 `ContainerUtil.emptyList()`）⇒ 那一格对配置行不生效。
//     订正留痕：这一处原先只写裸类名 —— 参考树里**同名文件有两份**（`runAnything/` 与 `runAnything/activity/`），
//     `activity/` 那一份的 `:56` 是 `getAdText()`，按裸类名读会钉错；故这里补全相对路径。
import { computed, nextTick, onMounted, ref } from 'vue'
import { Terminal, X } from 'lucide-vue-next'
import { buildRunAnythingRows, commandDisplayName, loadRunAnythingHistory, pushRunAnythingHistory, RUN_ANYTHING_GROUP_TITLES, type RunAnythingGroupId, type RunAnythingRow } from '../runAnything'
import { CONTEXT_POPUP_TITLE, CONTEXT_TOOLTIP, allRunAnythingContexts, contextPath, resolveSelectedContext, type RunAnythingContext } from '../runAnythingContext'
import { isDesktop, request } from '../bridge'
import { recentDirectoryChooserStart, recentDirectoryPaths, rememberRunAnythingRecentDirectory } from '../runAnythingRecentDirectories'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  configs: Array<{ name: string; type?: string }>
  moduleRoots?: Record<string, string>
  /**
   * 「浏览目录…」这一行给不给。缺省 = `isDesktop`（桌面宿主有原生目录框，浏览器预览没有 ⇒ 不渲染）；
   * 显式给值只用于判据核两档（宿主不需要传）。
   */
  canBrowseDirectories?: boolean
}>()
const emit = defineEmits<{
  (event: 'runConfig', payload: { name: string }): void
  (event: 'runCommand', payload: { command: string; cwd?: string | null }): void
  (event: 'close'): void
}>()

const query = ref('')
const history = ref(loadRunAnythingHistory())
const selected = ref(0)
const input = ref<HTMLTextAreaElement>()
const expanded = ref<RunAnythingGroupId[]>([])
const rows = computed(() => buildRunAnythingRows(props.configs, query.value, history.value, { expanded: expanded.value }))

// ── 执行上下文那一格 ────────────────────────────────────────────────────────────
/** 宿主管线未接时 `moduleRoots` 是 undefined ⇒ 模块那一档为空（还有最近目录与浏览行两档，见下面 `cellVisible`）。 */
const moduleRoots = computed(() => props.moduleRoots ?? {})
/** 用户**显式**选中的那一档；null = 没选过（⇒ 不传 cwd）。 */
const context = ref<RunAnythingContext | null>(null)
/**
 * 候选表（上游 `allContexts()` `:235-240`）= 项目 + 模块根 + 「浏览目录…」 + 最近目录。
 * · 最近目录那一组**不再写「本仓没有」了**（原写「本仓没有对应的存储 ⇒ 给空表」、实际等价物就在
 *   `src/runAnythingRecentDirectories.ts`）：上游那份是 `State.paths`
 *   （`RunAnythingContextRecentDirectoryCache.kt:26-29`，`@State(... storages = [Storage(StoragePathMacros.WORKSPACE_FILE)])`
 *   见同文件 `:13-14`），随项目的 workspace 文件走；本仓那一段 = `projects.json` 的 `perProject[项目根].runAnythingRecentPaths`，
 *   灌进来的时机 = `src/workspaceLifecycle.ts` 读回项目设置那一处（`project.settings.get`）。
 *   表里每一项 = `RecentDirectoryContext(path)`（`RunAnythingExecutingContext.kt:31-32`），
 *   次序与上游一致：排在「浏览目录…」**之后**（`RunAnythingChooseContextAction.kt:238`）。
 * · 「浏览目录…」这一行在桌面端是真接得通的（不再是假控件）：宿主通道 `dialog.pickDirectory`
 *   → 入栈（`pushRecentDirectory`，规则在上游 `:139-147`）→ 把选中的那一档设成新加的那条最近目录
 *   （同文件 `:146`）。浏览器预览没有原生目录框 —— `src/bridgePreview.ts:342` 对未实现的 method 一律
 *   `DESKTOP_REQUIRED` ⇒ 那一档 `canBrowse: false` 藏掉，不留一个点了没反应的行。
 *   与上游剩下的差别：上游走 IDEA 自己的选择器（`isForcedToUseIdeaFileChooser = true`，`:136`），
 *   本仓桌面端走系统目录框，标题也由宿主写死（请求见 `docs/wiring-requests-2026-10-06-recentdirclose.md`）。
 * · 浏览的**起始目录** = 项目根（上游 `:138` `choose(project.guessProjectDir())`）⇒ `recentDirectoryChooserStart()`。
 */
const availableContexts = computed(() => allRunAnythingContexts({
  project: { basePath: '' },
  modules: Object.entries(moduleRoots.value).map(([name, root]) => ({ name, description: root })),
  recentDirectories: recentDirectoryPaths.value,
  canBrowse: props.canBrowseDirectories ?? isDesktop,
}))
/** 选择规则与「表空就隐藏」都出自 `resolveSelectedContext`（上游 `update()` `:62-78`），这里不重写。 */
const contextCell = computed(() => resolveSelectedContext(availableContexts.value, context.value))
/** 除了默认那档（项目根）之外还有第二档可换，这一格才有意义。 */
const cellVisible = computed(() => !contextCell.value.hidden && availableContexts.value.some(entry => entry.kind !== 'project'))
/** `<select>` 的当前项下标：没选过时显示表里第一档（上游 `:73`「还没选就取第一个」）。 */
const contextIndex = computed(() => {
  const current = contextCell.value.selected
  if (!current) return -1
  return availableContexts.value.findIndex(entry => entry.kind === current.kind && entry.value === current.value)
})
function chooseContext(index: number) {
  const entry = availableContexts.value[index]
  // 「浏览目录…」不是**一处目录**，是一个动作（上游 `BrowseDirectoryItem.actionPerformed`，`:132-150`）：
  // 它自己那档永远不会成为选中项（`getPath()` 对它返回 null，`RunAnythingContextUtils.kt:20`），
  // 点它 = 开选择器，选完把**新加的那条最近目录**设成当前档（`:146`）。
  if (entry?.kind === 'browse') { void browseContextDirectory(); return }
  context.value = entry ?? null
}
/** `<select>` 的模板引用：浏览**没改成选择**时要把显示改回原先那一档（绑定值没变 ⇒ Vue 不会自己写回 DOM）。 */
const contextSelect = ref<HTMLSelectElement>()
function restoreContextSelect() {
  const select = contextSelect.value
  if (select) select.value = String(contextIndex.value)
}
/**
 * 开一次目录选择器并记进缓存（上游 `:136-147` 那三步：选 → 入栈 → 设为当前上下文）。
 * 取消（宿主回 `null`）与宿主报错都**什么都不记**：前者与上游同结果（`choose` 没回值就不进那段代码），
 * 后者的失败记在桥接的调用账上（`src/bridge.ts:899-903` 把那一条 `traces` 标成 `error`，「操作输出」列它：
 * `src/App.vue:2203-2204`；**不是** `app.internalErrors` —— 原生分派的 `catch`（`native/main.cpp:1509-1515`）不写那本账），
 * 这里没有第二条报错通道
 * —— 要一句可见的提示得由宿主把 `notify` 传进来，见 `docs/wiring-requests-2026-10-06-recentdirclose.md`。
 */
async function browseContextDirectory() {
  let picked: string | null = null
  try { picked = await request<string | null>('dialog.pickDirectory', { initial: recentDirectoryChooserStart() }) }
  catch { restoreContextSelect(); return }
  if (!picked) { restoreContextSelect(); return }
  const paths = rememberRunAnythingRecentDirectory(picked)
  const chosen = paths[paths.length - 1]
  // 取**最后**一条同值的：同一个目录浏览两次就是两档（上游不去重），选中要落在刚加的那条上。
  context.value = availableContexts.value.filter(entry => entry.kind === 'recentDirectory' && entry.value === chosen).pop() ?? null
  restoreContextSelect()
}

function move(delta: number) {
  const list = rows.value
  if (!list.length) return
  selected.value = (selected.value + delta + list.length) % list.length
}
function pick(row: RunAnythingRow | undefined) {
  if (!row) return
  if (row.kind === 'more') {
    if (!expanded.value.includes(row.group)) expanded.value = [...expanded.value, row.group]
    return
  }
  // 历史行保留原始类别：命令历史用命令行通道重跑，不按同名配置找。
  const kind = row.sourceKind ?? row.kind
  if (kind === 'command') {
    history.value = pushRunAnythingHistory({ kind: 'command', name: row.name, detail: row.detail })
    // 工作目录 = 选中那一档的 `getPath()`（`runAnythingContext.ts:80`，上游 `RunAnythingContextUtils.kt:14-21`）。
    // 三种情况都**不带 cwd 键**发出去（不是带一个空串）：没选过（`context` 是 null）、选了「项目」
    // （本仓相对路径口径下是空串，`runAnythingContext.ts:80`）、那一档算不出目录（上游对「浏览…」返回 null，`:20`）。
    // 收端 `src/runActions.ts:515` 的 `cwd?.trim() || workspace.value.root` 于是落在工作区根。
    const cwd = context.value ? contextPath(context.value, moduleRoots.value) : null
    emit('runCommand', cwd ? { command: row.name, cwd } : { command: row.name })
    return
  }
  history.value = pushRunAnythingHistory({ kind: 'config', name: row.name, detail: row.detail })
  emit('runConfig', { name: row.name })
}
function onQuery() { selected.value = 0 }
// 组标题：只在组的第一行上方显示（上游 RunAnythingGroup.getTitle 的插入行）。
function groupTitleAt(index: number): string {
  const row = rows.value[index]
  const previous = rows.value[index - 1]
  return row && (!previous || previous.group !== row.group) ? RUN_ANYTHING_GROUP_TITLES[row.group] : ''
}
onMounted(() => { void nextTick(() => input.value?.focus()) })
</script>

<template>
  <div class="modal-backdrop run-anything-backdrop" @click.self="emit('close')">
    <section class="command-palette run-anything" role="dialog" aria-modal="true" aria-label="Run Anything" @keydown.esc.prevent="emit('close')">
      <div class="palette-input">
        <Terminal :size="iconSize.action" />
        <textarea
          ref="input" v-model="query" rows="1" class="run-anything-input" placeholder="输入运行配置名，或直接输入命令（> 前缀强制按命令运行；Shift+Enter 换行）" aria-label="Run Anything"
          spellcheck="false" @input="onQuery"
          @keydown.enter.exact.prevent="pick(rows[selected])"
          @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)"
        ></textarea>
        <label v-if="cellVisible" class="run-ctx" :title="CONTEXT_TOOLTIP">
          <span class="run-ctx-title">{{ CONTEXT_POPUP_TITLE }}</span>
          <select
            ref="contextSelect"
            class="run-ctx-select" :value="contextIndex" :aria-label="CONTEXT_POPUP_TITLE"
            @change="chooseContext(Number(($event.target as HTMLSelectElement).value))"
          >
            <option
              v-for="(entry, index) in availableContexts" :key="`${entry.kind}:${entry.value}:${index}`" :value="index"
              :title="entry.description || undefined"
            >{{ entry.label }}</option>
          </select>
        </label>
        <button class="icon-button" aria-label="关闭" title="关闭" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
      <div class="palette-results" role="listbox" aria-label="Run Anything 候选">
        <template v-for="(row, index) in rows" :key="`${row.kind}:${row.name}:${index}`">
          <p v-if="groupTitleAt(index)" class="run-anything-group">{{ groupTitleAt(index) }}</p>
          <button
            class="location-row run-anything-row" :class="{ highlighted: index === selected, 'run-anything-more': row.kind === 'more' }" role="option" :aria-selected="index === selected"
            @click="pick(row)" @pointerenter="selected = index"
          >
            <Terminal :size="iconSize.toolbar" aria-hidden="true" />
            <span class="location-main"><strong>{{ row.kind === 'command' || row.sourceKind === 'command' ? commandDisplayName(row.name) : row.name }}</strong><span class="run-anything-detail">{{ row.detail }}</span></span>
            <span class="run-anything-kind">{{ row.kind === 'more' ? '更多' : row.kind === 'command' || row.sourceKind === 'command' ? '命令' : row.kind === 'history' ? '最近' : '配置' }}</span>
          </button>
        </template>
        <p v-if="!rows.length" class="palette-empty">没有匹配的运行配置</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.run-anything-backdrop { align-items: flex-start; }
.run-anything { margin-top: 12vh; width: 640px; max-width: 92vw; }
.run-anything-detail { margin-left: var(--space-2); color: var(--muted); font-size: 11px; }
.run-anything-kind { flex-shrink: 0; margin-left: auto; color: var(--muted); font-size: 11px; }
/* 原先这里还有一条 `.run-anything-row { align-items: baseline; }` —— 它是**死声明**：
   该元素同时带 `.location-row`（style.css:1062 `align-items: flex-start !important`），
   `!important` 赢过这条普通声明，实际生效的一直是 flex-start（与「最近位置」那种多行行同款：
   图标顶对齐、正文两行）。删掉它，不再留一个写了却不起作用的覆盖。 */
.run-anything-row strong { color: var(--bright); font-family: var(--font-mono); }
.run-anything-more strong { color: var(--accent); }
.run-anything-group { margin: 0; padding: var(--space-1) var(--space-3) 0; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
/* 执行上下文那一格（上游 `RunAnythingChooseContextAction` 的 `ActionButtonWithText`，在输入行右侧）：
   用 tokens，不写裸色值/时长；字号与同一行里的 `.run-anything-detail`/`.run-anything-kind` 齐平。 */
.run-ctx { display: flex; flex-shrink: 0; align-items: center; gap: var(--space-1); margin-left: var(--space-2); }
.run-ctx-title { color: var(--muted); font-size: 11px; white-space: nowrap; }
.run-ctx-select { min-width: 96px; max-width: 180px; min-height: var(--ctrl-height-sm, 22px); padding: 2px var(--space-1); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px var(--font-mono); }
.run-anything-input { flex: 1; min-width: 0; box-sizing: border-box; min-height: var(--ctrl-height-sm, 22px); max-height: 88px; resize: vertical; padding: 2px var(--space-2); color: var(--text); background: transparent; border: 0; outline: none; font: inherit; font-family: var(--font-mono); }
</style>
