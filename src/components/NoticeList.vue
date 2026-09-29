<script setup lang="ts">
// The notification list itself, shared by the status bar widget and by the welcome screen's
// notification toolbar (`WelcomeScreenComponentFactory.createNotificationToolbar:399-451` shows the
// same list in both places in IDEA). Rows print the time, the message, its detail lines and are
// coloured by severity; the head carries "全部清空" and Escape closes the popup.
import { NOTICE_PREVIEW_LIMIT, noticePreview, noticeProgressLabel, type NoticeAction, type NoticeEntry } from '../notices'

const props = withDefaults(defineProps<{
  entries: NoticeEntry[]
  /** Announce new entries to assistive technology (IDEA's screen-reader support). */
  live?: boolean
  label?: string
}>(), { live: false, label: '最近通知' })

const emit = defineEmits<{ clear: []; close: []; expire: [id: number]; run: [action: NoticeAction] }>()

const rows = () => noticePreview(props.entries, NOTICE_PREVIEW_LIMIT)
</script>

<template>
  <div
    v-if="props.entries.length" class="status-notice-list" role="log"
    :aria-live="props.live ? 'polite' : 'off'" :aria-label="props.label"
    @keydown.esc.stop="$emit('close')"
  >
    <div class="status-notice-head">
      <span>通知</span>
      <button class="subtle-button" @click="$emit('clear')">全部清空</button>
    </div>
    <p v-for="entry in rows()" :key="entry.id" class="status-notice-row" :class="{ error: entry.error }">
      <span class="status-notice-time">{{ entry.at }}</span>
      <span class="status-notice-body">
        <span>{{ entry.message }}</span>
        <small v-for="(line, index) in entry.detail ?? []" :key="index" class="status-notice-detail">{{ line }}</small>
        <!-- 进度行：有数字才画条（`ExternalSystemTaskProgressIndicatorUpdater.kt` 的 total<=0 就是
             indeterminate），没数字只写"进行中"，跑完这一栏变成 100% 的结论。 -->
        <!-- 通知自带的动作按钮（上游 `Notification.addAction`）：点了先收掉这条通知再执行，
             与 `LspServerNotificationsHandlerImpl.kt:443-454` 里 `notification.expire()` 的次序一致。 -->
        <span v-if="entry.actions?.length" class="status-notice-actions">
          <button v-for="action in entry.actions" :key="action.label" class="subtle-button"
                  @click="emit('expire', entry.id); emit('run', action)">{{ action.label }}</button>
        </span>
        <small v-if="noticeProgressLabel(entry)" class="status-notice-progress">
          <span v-if="entry.percent !== null" class="status-notice-track" :style="{ width: `${entry.percent}%` }" />
          {{ noticeProgressLabel(entry) }}
        </small>
      </span>
    </p>
  </div>
</template>
