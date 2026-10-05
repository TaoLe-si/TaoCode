<script setup lang="ts">
// 通知中心工具窗口（上游 `NotificationsToolWindowFactory` + `NotificationsPanel`）。
//
// 与状态栏那个弹层（`NoticeList.vue`）的关系照上游：`NotificationsPanel` 与状态栏 widget
// 读的是**同一份**通知日志（`NotificationsManagerImpl` 的 log + `NotificationsWidgetFactory`），
// 区别只在呈现：弹层是最近若干条的单列，工具窗口是「建议 / 时间线」两段、带搜索、
// 每行一个 ⋮ 菜单（`NotificationsPanel.kt:1106-1153`）。
//
// 宿主只给三样：日志条目、当前工作区根（决定「不再为此项目显示」有没有落点）、
// 以及两条现成的通道（清空 / 收掉一条并跑它的动作）。「不再显示」「明天提醒我」的副作用
// 由本组件自己落（src/notificationDoNotAsk.ts），随应用重启仍然有效
// （localStorage，与 `src/todoFilters.ts` 同一族做法）。
import { computed, ref } from 'vue'
import { Bell, BellOff, MoreHorizontal, Search } from 'lucide-vue-next'
import {
  EVENT_LOG_CLEAR_ALL_LABEL, EVENT_LOG_MORE_TITLE, doNotAskIdOf, eventLogRowMenu, eventLogSections,
  type EventLogEntry, type EventLogMenuItem,
} from '../notificationEventLog'
import {
  DO_NOT_ASK_EMPTY, DO_NOT_ASK_LIST_ACCESSIBLE_NAME, DO_NOT_ASK_LIST_TITLE,
  clearDoNotAskInfo, doNotAskDisplayName, doNotAskInfos,
  markDoNotAsk, scheduleRemindLater, type DoNotAskInfo,
} from '../notificationDoNotAsk'
import { groupPlaysSound, groupSoundToggleLabel, setGroupPlaysSound } from '../notificationBeeper'
import { noticeGroupId } from '../notificationGroups'
import { noticeProgressLabel } from '../notices'
import { iconSize } from '../uiIcons'

const props = withDefaults(defineProps<{
  entries: EventLogEntry[]
  /** 当前工作区根（空 = 没有项目）。 */
  root?: string
}>(), { root: '' })

const emit = defineEmits<{
  clear: []
  expire: [id: number]
  run: [action: { label: string; run: () => void }]
}>()

const query = ref('')
const openMenu = ref<number | null>(null)

// 上游 `NotificationsPanel` 有两个 `NotificationGroupComponent`（`:538-613`），空段不画
// （`isEmpty()` + `NullableComponent`）；搜索是 `matchQuery:1347-1364` 的子串匹配。
const sections = computed(() => eventLogSections(props.entries, query.value))

function toggleMenu(id: number) { openMenu.value = openMenu.value === id ? null : id }

/**
 * 「不再显示」/「不再为此项目显示」/「明天提醒我」的副作用都落在这里（上游是
 * `Notification.setDoNotAskFor` / `RemindLaterManager`；本仓的实现与存储口径见
 * `src/notificationDoNotAsk.ts`）。点完照上游把这一条**收掉**并收起菜单
 * （`NotificationsPanel.kt:1123-1127` 的 `remindAction.run()` + `myRemoveCallback` + `hideBalloon`；
 * `NotificationBalloonActionProvider.java:233-236` 的 `setDoNotAskFor` + `expire()`）。
 */
function menuItems(entry: EventLogEntry): EventLogMenuItem[] {
  const id = doNotAskIdOf(entry)
  const rest = eventLogRowMenu(entry, {
    projectRoot: props.root,
    remindTomorrow: row => {
      scheduleRemindLater(row, Date.now())
      emit('expire', row.id)
    },
    doNotAskForProject: row => {
      markSuppressed(id, row.message, true)
      emit('expire', row.id)
    },
    doNotAskForApp: row => {
      markSuppressed(id, row.message, false)
      emit('expire', row.id)
    },
  })
  const sound = groupSoundItem(entry)
  // 上游 `NotificationsPanel.kt:1110` 把「设置…」放在**第一个**、提醒/不再显示之前
  // （中间那条分隔线在 `:1115`）。本仓没有通知设置页，于是把那个对话框里与声音有关的
  // 唯一一项提上来做成一个真开关；没有注册组的行不画它（`:1109` 的 isRegistered）。
  return sound ? [sound, ...rest] : rest
}

/**
 * 「播放声音」这一项（`NotificationSettingsUi.kt:56-65` 那个复选框）。
 * 开关是**按组**的（`NotificationSettings.kt:30` 默认 false），点完立刻落存储，
 * 下一条同组通知就按新的判定响或不响 —— 不是装饰。
 * label 要随点击后的状态变，所以用版本号让这一格重算。
 */
const soundVersion = ref(0)
function hasGroupSound(entry: EventLogEntry): boolean {
  void soundVersion.value
  return groupSoundToggleLabel(entry) !== undefined
}
function groupSoundItem(entry: EventLogEntry): EventLogMenuItem | undefined {
  void soundVersion.value
  const label = groupSoundToggleLabel(entry)
  if (!label) return undefined
  return {
    id: 'groupSound',
    label,
    run: () => {
      const groupId = noticeGroupId(entry)
      if (!groupId) return
      setGroupPlaysSound(groupId, !groupPlaysSound(groupId))
      soundVersion.value += 1
    },
  }
}

function run(item: EventLogMenuItem) { item.run(); openMenu.value = null }
function rowClick(event: MouseEvent) {
  // 点行身的空白处收起菜单（上游那个 ⋮ 弹层点外面就消失）。
  const target = event.target as HTMLElement | null
  if (target?.closest('.eventlog-more, .eventlog-menu')) return
  openMenu.value = null
}

/**
 * 「不再询问通知」那张清单 —— 上游挂在通知设置页里
 * （`platform/platform-impl/src/com/intellij/notification/impl/ui/DoNotAskConfigurableUi.kt`）：
 * 应用级 + 项目级两张表合成一列、**按 id 排序**（`:33-51`）、项目级那条在后面加
 * `（此项目）`（`:28`），工具条**只有移除**这一个动作（`:67` 的 `setRemoveAction`，
 * 没有上下移动、没有新增），移除就是按那一层调 `clearDoNotAsk(id)`（`:100-113`）。
 *
 * 本仓没有那一页设置（设置树 `src/settingsTreeMeta.ts` 是保留文件，通知那节没登记），
 * 所以清单落在**通知工具窗口**里：这是同一个数据（localStorage 那两张表）的同一个视图，
 * 只是宿主不同 —— 落点差异如实写在报告里。
 */
const suppressedOpen = ref(false)
const suppressedVersion = ref(0)
const suppressed = computed<DoNotAskInfo[]>(() => {
  void suppressedVersion.value
  return doNotAskInfos(props.root)
})
/** 解除抑制（上游那个移除按钮）：点完这一条就不再被压着，同 id 的通知恢复弹出。 */
function restoreNotice(info: DoNotAskInfo) {
  clearDoNotAskInfo(info, props.root)
  suppressedVersion.value += 1
}
/** 每一次按掉一条通知都会写那张表，所以菜单里的两个「不再显示」也要让清单重算。 */
function markSuppressed(id: string | undefined, message: string, forProject: boolean) {
  if (id) markDoNotAsk(id, message, forProject, props.root)
  suppressedVersion.value += 1
}
</script>

<template>
  <div class="event-log" @click="rowClick" @keydown.esc="openMenu = null">
    <div class="panel-heading">
      <span><Bell :size="iconSize.control" />通知</span>
      <div class="heading-actions">
        <label class="eventlog-search">
          <Search :size="iconSize.dense" aria-hidden="true" />
          <input v-model="query" aria-label="搜索通知" placeholder="搜索通知…" spellcheck="false" />
        </label>
        <!-- 「不再询问通知」那张清单：上游在通知设置页，本仓落在这里（同一份数据的同一个视图）。 -->
        <button class="icon-button eventlog-suppressed-toggle" :aria-expanded="suppressedOpen"
                :title="DO_NOT_ASK_LIST_TITLE" :aria-label="`${DO_NOT_ASK_LIST_ACCESSIBLE_NAME}（${suppressed.length}）`"
                @click.stop="suppressedOpen = !suppressedOpen">
          <BellOff :size="iconSize.menu" /><span>{{ suppressed.length }}</span>
        </button>
      </div>
    </div>
    <div v-if="suppressedOpen" class="eventlog-suppressed" :aria-label="DO_NOT_ASK_LIST_ACCESSIBLE_NAME">
      <div class="eventlog-section-head">
        <span class="eventlog-section-title">{{ DO_NOT_ASK_LIST_TITLE }}</span>
      </div>
      <!-- 一条都没有时给上游那句空态（`notifications.configurable.no.notifications.configured`）。 -->
      <p v-if="!suppressed.length" class="eventlog-suppressed-empty">{{ DO_NOT_ASK_EMPTY }}</p>
      <div v-for="info in suppressed" :key="`${info.forProject ? 'p' : 'a'}:${info.id}`" class="eventlog-suppressed-row">
        <span class="eventlog-suppressed-name">{{ doNotAskDisplayName(info) }}</span>
        <span class="eventlog-suppressed-id">{{ info.id }}</span>
        <!-- 工具条只有**移除**这一个动作（`ToolbarDecorator.setRemoveAction`，`CommonBundle.button.remove` =「移除」）：
             移除 = 解除抑制，下一条同 id 的通知恢复弹出。 -->
        <button class="subtle-button" :title="`移除：${info.name}`" :aria-label="`移除：${info.name}`"
                @click="restoreNotice(info)">移除</button>
      </div>
    </div>
    <div class="eventlog-scroll">
      <template v-for="section in sections" :key="section.id">
        <div class="eventlog-section-head">
          <span class="eventlog-section-title">{{ section.title }}</span>
          <!-- 全部清除只挂在时间线那一段（`NotificationsPanel.kt:595-599`：建议段没有这个链接）。 -->
          <button v-if="section.id === 'timeline'" class="eventlog-link" @click="emit('clear')">{{ EVENT_LOG_CLEAR_ALL_LABEL }}</button>
        </div>
        <div v-for="entry in section.entries" :key="entry.id" class="eventlog-row" :class="{ error: entry.error }">
          <span class="eventlog-time">{{ entry.at }}</span>
          <span class="eventlog-body">
            <span class="eventlog-message">{{ entry.message }}</span>
            <small v-for="(line, index) in entry.detail ?? []" :key="index" class="eventlog-detail">{{ line }}</small>
            <small v-if="noticeProgressLabel(entry)" class="eventlog-progress">
              <span v-if="entry.percent !== null" class="eventlog-track" :style="{ width: `${entry.percent}%` }" />
              {{ noticeProgressLabel(entry) }}
            </small>
            <span v-if="entry.actions?.length" class="eventlog-actions">
              <!-- 上游 `Notification.addAction`：点了动作先把这条通知 expire 掉
                   （`NotificationAction.createSimpleExpiring`，见 src/notices.ts 的注释）。 -->
              <button v-for="action in entry.actions" :key="action.label" class="subtle-button"
                      @click="emit('expire', entry.id); emit('run', action)">{{ action.label }}</button>
            </span>
          </span>
          <span class="menu-anchor eventlog-more-anchor">
            <button class="icon-button eventlog-more" :aria-expanded="openMenu === entry.id" :aria-haspopup="'menu'"
                    :title="EVENT_LOG_MORE_TITLE" :aria-label="`${EVENT_LOG_MORE_TITLE}：${entry.message}`"
                    @click.stop="toggleMenu(entry.id)"><MoreHorizontal :size="iconSize.menu" /></button>
            <div v-if="openMenu === entry.id" class="dropdown eventlog-menu" role="menu" @click.stop>
              <template v-for="(item, index) in menuItems(entry)" :key="item.id">
                <!-- `NotificationsPanel.kt:1115` 的 `group.addSeparator()`：设置项与提醒项之间那条。 -->
                <div v-if="index === 1 && hasGroupSound(entry)" class="eventlog-menu-sep" role="separator" />
                <button class="menu-item" role="menuitem" @click="run(item)">
                  <span class="menu-item-title">{{ item.label }}</span>
                </button>
              </template>
            </div>
          </span>
        </div>
      </template>
      <p v-if="!sections.length" class="eventlog-empty">{{ query.trim() ? '没有匹配的通知。' : '没有通知。' }}</p>
    </div>
  </div>
</template>

<style scoped>
.event-log { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.eventlog-search { display: inline-flex; align-items: center; gap: var(--space-1); padding: 0 var(--space-2); height: 22px; background: var(--elevated); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--muted); }
.eventlog-search > svg { flex-shrink: 0; }
.eventlog-search input { min-width: 0; width: 132px; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 11px; outline: none; }
.eventlog-scroll { flex: 1; min-height: 0; overflow: auto; padding-bottom: var(--space-2); }
.eventlog-section-head { display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-2) var(--space-3) var(--space-1); }
/* 段标题用中号字（上游 `myTitle.mediumFontFunction()`，NotificationsPanel.kt:581）。 */
.eventlog-section-title { color: var(--secondary); font-size: 11px; font-weight: 600; }
.eventlog-link { margin-left: auto; border: 0; background: transparent; color: var(--accent); font: inherit; font-size: 11px; padding: 0; }
.eventlog-link:hover { color: var(--accent-hover); text-decoration: underline; }
.eventlog-row { display: flex; align-items: flex-start; gap: var(--space-2); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); transition: background-color var(--dur-1) var(--ease); }
.eventlog-row:hover { background: var(--hover); }
.eventlog-row.error .eventlog-message { color: var(--error); }
.eventlog-time { flex-shrink: 0; color: var(--muted); font: 10px/1.7 var(--font-mono); font-variant-numeric: tabular-nums; }
.eventlog-body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.eventlog-message { color: var(--text); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.eventlog-detail { color: var(--secondary); font: 10px/1.6 var(--font-mono); overflow-wrap: anywhere; }
.eventlog-progress { position: relative; display: inline-flex; align-items: center; gap: var(--space-2); align-self: flex-start; padding: 1px var(--space-2); border-radius: var(--radius-pill); background: var(--rail); color: var(--secondary); font-size: 10px; }
.eventlog-track { position: absolute; left: 0; top: 0; bottom: 0; border-radius: var(--radius-pill); background: var(--accent-soft); }
.eventlog-actions { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.eventlog-more-anchor { display: inline-flex; align-self: center; }
.eventlog-more { width: 22px; height: 22px; }
.eventlog-menu { min-width: 180px; }
.eventlog-menu-sep { height: 1px; margin: var(--space-1) 0; background: var(--line-strong); }
.eventlog-empty { padding: var(--space-4) var(--space-3); color: var(--muted); font-size: 11px; line-height: 1.7; }
/* 「不再询问通知」那段（上游是设置页里的 JBList + ToolbarDecorator，只给移除一个动作）。 */
.eventlog-suppressed { border-bottom: 1px solid var(--line-strong); padding-bottom: var(--space-1); }
.eventlog-suppressed-toggle { display: inline-flex; align-items: center; gap: var(--space-1); padding: 0; }
.eventlog-suppressed-toggle > svg { flex-shrink: 0; }
.eventlog-suppressed-row { display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-1) var(--space-3); transition: background-color var(--dur-1) var(--ease); }
.eventlog-suppressed-row:hover { background: var(--hover); }
.eventlog-suppressed-name { color: var(--text); font-size: 11px; overflow-wrap: anywhere; }
.eventlog-suppressed-id { flex: 1; min-width: 0; color: var(--muted); font: 10px/1.6 var(--font-mono); overflow-wrap: anywhere; }
.eventlog-suppressed-empty { padding: var(--space-2) var(--space-3); color: var(--muted); font-size: 11px; }
</style>
