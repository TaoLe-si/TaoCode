<script setup lang="ts">
// 打开未信任项目时的确认框（IDEA `TrustedProjectsDialog.confirmOpeningOrLinkingUntrustedProject`
// + `TrustedProjectStartupDialog.kt`）：标题、警告文案、三个按钮与「以后不再询问」都由
// src/trustedProjects.ts 的纯常量给出；**消息面**（`MessageType` 的图标语义、`ExitActionType`
// 的按钮表、「不再询问」在取消关掉时不落库的规则）走 `src/messageDialog.ts` —— 上游对应
// `MessageDialogBuilder`（asWarning + doNotAsk）与 `DoNotAskOption.Adapter`。
//
// 与上游的差别（少的那部分在判词表里记着）：上游还有「信任所在文件夹」与 Windows Defender
// 排除项两个勾选，本仓只做「以后不再询问」这一个 —— 前者要 Folder 级信任的专门 UI，
// 后者依赖 Defender 集成。
import { computed, ref } from 'vue'
import { CircleAlert, CircleHelp, Info, TriangleAlert } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { MESSAGE_TYPE_ICON, messageButtons, messageDialogModel, shouldRememberChoice, type ExitActionType } from '../messageDialog'
import { TRUST_BUTTONS, TRUST_DIALOG_TITLE, TRUST_REMEMBER_LABEL, trustDialogMessage, type TrustChoice } from '../trustedProjects'

const props = defineProps<{ root: string; name: string }>()
const emit = defineEmits<{ resolve: [choice: TrustChoice, remember: boolean] }>()
const remember = ref(false)
// 三个按钮就是上游的三个选择：信任（yes）/ 安全模式（no）/ 取消（cancel）—— 文案仍是
// TrustAlertDialog 的原文，ExitActionType 只决定语义与「取消默认不记」这条规则。
const model = computed(() => messageDialogModel({
  type: 'warning',
  title: TRUST_DIALOG_TITLE,
  message: trustDialogMessage(props.name, props.root),
  buttons: messageButtons(['cancel', 'no', 'yes'], { yes: TRUST_BUTTONS.trust, no: TRUST_BUTTONS.distrust, cancel: TRUST_BUTTONS.cancel }),
  doNotAsk: TRUST_REMEMBER_LABEL,
}))
// lucide 组件名 → 组件（名字来自 src/messageDialog.ts 的 MESSAGE_TYPE_ICON 表）。
const TYPE_ICONS: Record<string, typeof CircleHelp> = { CircleAlert, Info, TriangleAlert, CircleHelp }
const icon = computed(() => TYPE_ICONS[MESSAGE_TYPE_ICON[model.value.type]] ?? CircleHelp)
const CHOICES: Record<ExitActionType, TrustChoice> = { yes: 'trust', no: 'distrust', cancel: 'cancel', ok: 'cancel' }
function answer(exit: ExitActionType) {
  emit('resolve', CHOICES[exit], shouldRememberChoice(model.value, remember.value, exit))
}
</script>

<template>
  <div class="modal-backdrop" @click.self="answer('cancel')">
    <section class="help-dialog exit-dialog" role="alertdialog" aria-modal="true" :aria-label="model.title">
      <h2 class="trusted-dialog-title"><component :is="icon" :size="iconSize.action" aria-hidden="true" />{{ model.title }}</h2>
      <p>{{ model.message }}</p>
      <p class="small-muted">{{ props.root }}</p>
      <label v-if="model.doNotAsk" class="checkbox-row"><input v-model="remember" type="checkbox" /><span>{{ model.doNotAsk }}</span></label>
      <div class="leave-actions">
        <button v-for="button in model.buttons" :key="button.exit" :class="button.exit === 'yes' ? 'primary-button' : 'subtle-button'" @click="answer(button.exit)">{{ button.text }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.trusted-dialog-title { display: flex; align-items: center; gap: var(--space-2); }
</style>
