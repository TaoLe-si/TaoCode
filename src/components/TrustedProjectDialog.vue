<script setup lang="ts">
// 两个确认框共用这一个组件（同一个消息框壳子，`src/messageDialog.ts`）：
//   ① `mode='startup'`（缺省）：打开未信任项目时的确认框（IDEA `TrustedProjectsDialog.kt:44-96`
//      + `TrustedProjectStartupDialog.kt`）—— 标题、警告文案、三个按钮与「以后不再询问」都由
//      `src/trustedProjects.ts` 的纯常量给出；
//   ② `mode='link'`：在**未信任项目**里打开外部链接前的那一句
//      （`platform/platform-impl/src/com/intellij/ide/browsers/BrowserLauncherImpl.kt:59-87`，
//      由 `browse()` 在开之前调（`platform/platform-api/src/com/intellij/ide/browsers/BrowserLauncherAppless.kt:99`））。
//      上游的三个按钮是 Open / Trust Project and Open / Cancel（`IdeBundle.properties:3149-3153`）、
//      默认按钮 Open（`:79`）、**焦点**在 Trust（`:80`）⇒ 本仓把 primary 给焦点那一颗；
//      「Enter = 默认按钮」这一档本仓的消息框没有对应概念，如实登记（见本批报告 §6）。
//      宿主必须先问 `externalLinkPrompt(url, root, entries)`（已信任时它返回 null = 根本不弹）。
// 与上游的差别（少的那部分在判词表里记着）：上游还有 Windows Defender 排除项那一格
// （`TrustedProjectsDialog.kt:76-93`），本仓宿主没有 Defender 通道；文件级信任
// （`confirmOpeningUntrustedFile` `:89-108`）本仓的存储只有目录级，做不到。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { CircleAlert, CircleHelp, Info, TriangleAlert } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { MESSAGE_TYPE_ICON, messageButtons, messageDialogModel, shouldRememberChoice, type ExitActionType } from '../messageDialog'
// 挂载状态报给那一条 URL 出口（宿主还没挂 `mode="link"` 时不能让问句永远 pending）：
// 见 `src/externalLinkLauncher.ts` 的 `linkDialogIsMounted`。
import { markLinkDialogMounted } from '../externalLinkLauncher.ts'
import {
  EXTERNAL_LINK_LABELS, EXTERNAL_LINK_TITLE, TRUST_BUTTONS, TRUST_DIALOG_TITLE,
  TRUST_REMEMBER_LABEL, externalLinkMessage, isProjectLocationOfferedForTrust, trustAllLabel, trustDialogMessage,
  trustedLocationParent,
  type ExternalLinkChoice, type TrustChoice,
} from '../trustedProjects'

const props = defineProps<{
  root: string
  name: string
  /** 缺省 `startup`；`link` = 打开外部链接前的那一句。 */
  mode?: 'startup' | 'link'
  /** `link` 模式要问的那条 URL。 */
  url?: string
  /** 宿主在 `@resolve` 的**第三个回值**里接住了 trust-all 才传 true；不传就不画这一格（不放假控件）。 */
  canTrustAll?: boolean
  /** IDE 自己的配置目录（`TrustedProjects.isProjectLocationOfferedForTrust`，`TrustedProjects.kt:103-107`）。 */
  configDir?: string | null
}>()
// `resolve` 的第三个回值 = 「始终信任来自此来源的项目」（`TrustedProjectsDialog.kt:66-70`）；
// `resolveLink` 单独一条事件：它的取值是 `ExternalLinkChoice`（open/trust/cancel），
// 与启动确认框的 `TrustChoice`（trust/distrust/cancel）不是同一张表，不能混进同一个回值。
const emit = defineEmits<{
  resolve: [choice: TrustChoice, remember: boolean, trustAll: boolean]
  resolveLink: [choice: ExternalLinkChoice]
}>()
const remember = ref(false)
const trustAll = ref(false)
const linkMode = computed(() => props.mode === 'link')
// 「这颗框此刻在不在屏幕上」报给那一条 URL 出口（`src/externalLinkLauncher.ts`）：
// 门禁是装配时就装上的，而这一档弹框要等宿主把它挂进模板（接线请求 welcome3 的 W1 第 4 条）。
// 没有这个信号，宿主还没挂框的那段时间里问句会永远 pending ⇒ 链接点了没反应（比接线前更糟）。
// 报的只有 `mode="link"` 这一档：startup 那一档答的是 `TrustChoice`，另一张表，不算「外链问句在屏上」。
onMounted(() => { if (linkMode.value) markLinkDialogMounted(true) })
onBeforeUnmount(() => { if (linkMode.value) markLinkDialogMounted(false) })
/** 这一格画不画：宿主接得住（`canTrustAll`）+ 这一项允许被提供（父目录不在配置目录里）。 */
const trustAllAvailable = computed(() =>
  !linkMode.value && props.canTrustAll === true && isProjectLocationOfferedForTrust(props.root, props.configDir ?? null))
/** tooltip 用的父目录完整路径（上游把 pathString 放进悬停提示，`StartupDialog:94-95`）。 */
const trustAllParentPath = computed(() => trustedLocationParent(props.root) ?? '')
// 三个按钮就是上游的三个选择：信任（yes）/ 安全模式（no）/ 取消（cancel）—— 文案仍是
// TrustAlertDialog 的原文，ExitActionType 只决定语义与「取消默认不记」这条规则。
const model = computed(() => messageDialogModel(linkMode.value
  ? {
    type: 'warning',
    title: EXTERNAL_LINK_TITLE,
    message: externalLinkMessage(props.url ?? ''),
    // 顺序照上游 `buttons(yesLabel, trustLabel, noLabel)`：Open、Trust、Cancel。
    buttons: messageButtons(['no', 'yes', 'cancel'], {
      no: EXTERNAL_LINK_LABELS.open, yes: EXTERNAL_LINK_LABELS.trust, cancel: EXTERNAL_LINK_LABELS.cancel,
    }),
  }
  : {
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
// 链接那一句的三个按钮：`yes` 给的是「信任项目并打开」（primary/焦点那一颗），`no` 是「打开」。
const LINK_CHOICES: Record<ExitActionType, ExternalLinkChoice> = { yes: 'trust', no: 'open', cancel: 'cancel', ok: 'cancel' }
function answer(exit: ExitActionType) {
  if (linkMode.value) { emit('resolveLink', LINK_CHOICES[exit]); return }
  emit('resolve', CHOICES[exit], shouldRememberChoice(model.value, remember.value, exit),
    trustAllAvailable.value && trustAll.value)
}
</script>

<template>
  <div class="modal-backdrop" @click.self="answer('cancel')">
    <section class="help-dialog exit-dialog" role="alertdialog" aria-modal="true" :aria-label="model.title">
      <h2 class="trusted-dialog-title"><component :is="icon" :size="iconSize.action" aria-hidden="true" />{{ model.title }}</h2>
      <p>{{ model.message }}</p>
      <p v-if="!linkMode" class="small-muted">{{ props.root }}</p>
      <label v-if="model.doNotAsk" class="checkbox-row"><input v-model="remember" type="checkbox" /><span>{{ model.doNotAsk }}</span></label>
      <!-- 「始终信任来自此来源的项目」（TrustedProjectsDialog.kt:66-70 + StartupDialog:86-92）：
           勾上且答「信任并打开」时宿主把**父目录**写进 trustedPaths。文案带父目录文件夹名
           （`untrusted.project.warning.trust.location.checkbox` 的 {0}，IdeBundle.properties:2949），
           tooltip 给完整路径（StartupDialog `:94-95` 的 toolTipText 与悬停 = projectParentPath.pathString）。
           宿主没接第三个回值时 `canTrustAll` 不为真 ⇒ 整格不画。 -->
      <label v-if="trustAllAvailable" class="checkbox-row" :title="trustAllParentPath">
        <input v-model="trustAll" type="checkbox" /><span>{{ trustAllLabel(props.root) }}</span>
      </label>
      <div class="leave-actions">
        <button v-for="button in model.buttons" :key="button.exit" :class="button.exit === 'yes' ? 'primary-button' : 'subtle-button'" @click="answer(button.exit)">{{ button.text }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.trusted-dialog-title { display: flex; align-items: center; gap: var(--space-2); }
</style>
