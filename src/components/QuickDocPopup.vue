<script setup lang="ts">
// 快速文档弹层的**渲染层**（Ctrl+Q，`DocumentationManager` 的那一面）。
//
// 只负责渲染与派发事件：形状与副作用在 `src/quickDocHost.ts`，区块/分节/几何在
// `src/quickDocLayout.ts`，前进后退在 `src/quickDocHistory.ts`，hover 取值与整形在
// `src/hoverDocumentation.ts`，内容解析在 `src/documentationView.ts`。
//
// 渲染的是上游 `DocumentationMarkup`（`platform/analysis-api/src/com/intellij/lang/documentation/
// DocumentationMarkup.java:13-31`）的四块，class 名照抄；CSS 侧同名规则即对
// `DocumentationHtmlUtil.getDocumentationPaneAdditionalCssRules`（`DocumentationHtmlUtil.kt:116-138`）的翻译：
//   · `definition` —— 签名，等宽（上游 `getStyledSignatureFragment`，`LspDocumentationData.kt:85-88`）；
//   · `content`    —— 正文；
//   · `sections`   —— 分节表，左格 `section` 灰化不换行、右格 `valign=top`（`:28-31`）；
//   · `bottom`     —— 面板底部那一行的外部文档链接（`ExternalDocumentationHandler.java:31-40`）。
//
// 两条上游后处理：`removeEmptySections` 的空节在布局阶段已删（`DocumentationHtmlUtil.kt:143-149`）；
// `addExternalLinkIcons` 给 `http` 链接追加 `AllIcons.Ide.External_link_arrow`（`:152-159`）——
// 本仓用 lucide `ExternalLink` 占同一个位置。
//
// 键位逐条抄上游（三个动作都用 `use-shortcut-of` 继承别人的键，
// `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:46-53`）：
//   · `Documentation.Back`    → `use-shortcut-of="Back"`    → Ctrl+Alt+Left  （`$default.xml:296-299`）
//   · `Documentation.Forward` → `use-shortcut-of="Forward"` → Ctrl+Alt+Right （`$default.xml:901-904`）
//   · `Documentation.ViewExternal` → `use-shortcut-of="ExternalJavaDoc"` → Shift+F1（`$default.xml:588-590`）
// 上游 `update()` 把栈空的后退/前进置灰（`DocumentationBackAction.kt:14`），没有外部 URL 的
// 「在浏览器中打开」整个不可见（`DocumentationViewExternalAction.kt:15`）——这里照做：
// disabled 的按钮不发事件。没handled 的键**不**拦冒泡，Ctrl+Q 还要能穿透到全局键位去换下一页。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, ExternalLink, MousePointer, RefreshCw, X } from 'lucide-vue-next'
import { useBestPositionAnchor } from '../popupPlacement'
import { iconSize } from '../uiIcons'
import type { DocImage, DocLink, DocPart } from '../documentationView.ts'
import { DOC_HOVER_LABELS, docHoverPolicy, toggleDocHoverPolicy, type DocHoverPolicy, type DocHoverSettingsPatch } from '../docHoverPolicy.ts'
import type { QuickDocLayout } from '../quickDocLayout.ts'

const props = defineProps<{
  layout: QuickDocLayout
  /** 文档所在文件（图片相对路径按它解析；标题栏显示它）。 */
  origin: string
  x: number
  y: number
  canBackward: boolean
  canForward: boolean
  canOpenExternal: boolean
  /**
   * 「在鼠标移动时显示」这**一档现在有没有生效的落点**。它的生效点在编辑器的 hover 通道
   * （`src/components/CodeEditor.vue` 的 `hoverTooltip`，保留文件 ⇒ 走接线请求）。
   * 请求没落地时这里是 false：按钮**不渲染** —— 勾了没反应的开关就是假控件。
   */
  canToggleHover?: boolean
  /** 图片字节 → data URL；解不出来返回 null（渲染层退回 alt 文本）。 */
  resolveImage: (image: DocImage, documentPath: string) => Promise<string | null>
}>()
const emit = defineEmits<{
  (event: 'close'): void
  (event: 'back'): void
  (event: 'forward'): void
  (event: 'open-external'): void
  (event: 'follow', link: DocLink): void
  /** 齿轮改了一档：把要写回设置的补丁交给宿主持久化（`docHoverPolicyPatch()` 的形状）。 */
  (event: 'policy-change', patch: DocHoverSettingsPatch): void
}>()

/**
 * 两档的当前值**直接读 `src/docHoverPolicy.ts` 那份运行时真值**，不从 props 传：
 * 上游那两个 `ToggleAction` 读写的也是单例（`EditorSettingsExternalizable` /
 * `DocumentationToolWindowManager.autoUpdate`），组件只是它的一个视图。
 * 这样 `App.vue`（保留文件）现在的调用形状不用改就能渲染出「自动更新」那一档，
 * 请求落地时只需要补 `@policy-change` 与 `:can-toggle-hover`。
 */
const autoUpdate = computed(() => docHoverPolicy.autoUpdate)
const showOnMouseMove = computed(() => docHoverPolicy.showOnMouseMove)
function togglePolicy(key: keyof DocHoverPolicy) { emit('policy-change', toggleDocHoverPolicy(key)) }

const box = ref<HTMLElement>()
// `showInBestPositionFor(editor)`（`AbstractPopup.java:974-993`）：锚在光标下方；越界夹取与
// 翻转都在 `src/popupPlacement.ts`（不再像原先那样按常数猜高度）。
const { style: anchor } = useBestPositionAnchor(box, () => ({ x: props.x, y: props.y }))

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close'); return }
  if (event.ctrlKey && event.altKey && (event.code === 'ArrowLeft' || event.code === 'ArrowRight')) {
    event.preventDefault()
    event.stopPropagation()
    if (event.code === 'ArrowLeft') { if (props.canBackward) emit('back') }
    else if (props.canForward) emit('forward')
    return
  }
  // Shift+F1（`ExternalJavaDoc`）：F1 在新 UI 里是「这一行的用法」，没有本仓的绑键，让它冒泡。
  if (event.shiftKey && event.key === 'F1') {
    if (!props.canOpenExternal) return
    event.preventDefault()
    event.stopPropagation()
    emit('open-external')
  }
}
function onPointerDown(event: PointerEvent) { if (!box.value?.contains(event.target as Node)) emit('close') }
onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true)
  void nextTick(() => box.value?.focus())
})
onUnmounted(() => window.removeEventListener('pointerdown', onPointerDown, true))

/**
 * 分段取用的两个小函数：模板里做 `in` 收窄不如显式取值稳（vue-tsc 对模板收窄的表达
 * 支持有限），而且 `partLink(part)` 在 `v-if` 与子节点里是同一个调用点。
 */
function partLink(part: DocPart): DocLink | null {
  return 'link' in part ? part.link : null
}
function partText(part: DocPart): string {
  return 'link' in part ? '' : part.text
}

/**
 * 弹层里点一条链接 —— 外部链接走「在浏览器中打开」那个动作，锚点没有可滚的目标就
 * **什么都不做**（内容是一段流，不是整页 HTML），内部链接交给宿主分派（符号引用换页、
 * 带路径的跳编辑器 —— 见 `src/quickDocHost.ts` 的 `followInternalDocLink`）。
 */
function onLink(link: DocLink | null) {
  if (!link) return
  if (link.kind === 'external') { emit('open-external'); return }
  if (link.kind === 'anchor') return
  emit('follow', link)
}

/** 图片按需解析：解不出来就退回 alt 文本（`DocumentationImageResolver.java:21` 的 null 契约）。 */
const imageSources = ref<Record<string, string>>({})
watch(() => props.layout.images, async images => {
  const next: Record<string, string> = {}
  for (const image of images) {
    const source = await props.resolveImage(image, props.origin)
    if (source) next[image.src] = source
  }
  imageSources.value = next
}, { immediate: true })
</script>

<template>
  <div ref="box" class="quickdoc-popup" role="dialog" aria-label="快速文档" tabindex="-1" :style="anchor" @keydown="onKeydown">
    <div class="quickdoc-header">
      <span class="quickdoc-title">快速文档</span>
      <span class="quickdoc-origin" :title="origin">{{ origin }}</span>
      <button class="icon-button" :disabled="!canBackward" title="后退（Ctrl+Alt+左）" aria-label="后退" @click="emit('back')"><ArrowLeft :size="iconSize.control" /></button>
      <button class="icon-button" :disabled="!canForward" title="前进（Ctrl+Alt+右）" aria-label="前进" @click="emit('forward')"><ArrowRight :size="iconSize.control" /></button>
      <button class="icon-button" :disabled="!canOpenExternal" title="在浏览器中打开（Shift+F1）" aria-label="在浏览器中打开" @click="emit('open-external')"><ExternalLink :size="iconSize.control" /></button>
      <button class="icon-button" :class="{ 'is-on': autoUpdate }" :aria-pressed="autoUpdate" :title="DOC_HOVER_LABELS.autoUpdate" :aria-label="DOC_HOVER_LABELS.autoUpdate" @click="togglePolicy('autoUpdate')"><RefreshCw :size="iconSize.control" /></button>
      <button v-if="canToggleHover" class="icon-button" :class="{ 'is-on': showOnMouseMove }" :aria-pressed="showOnMouseMove" :title="DOC_HOVER_LABELS.showOnMouseMove" :aria-label="DOC_HOVER_LABELS.showOnMouseMove" @click="togglePolicy('showOnMouseMove')"><MousePointer :size="iconSize.control" /></button>
      <button class="icon-button" title="关闭快速文档" aria-label="关闭" @click="emit('close')"><X :size="iconSize.control" /></button>
    </div>
    <div class="quickdoc-body">
      <div v-if="layout.definition" class="quickdoc-definition"><pre>{{ layout.definition.code }}</pre></div>
      <div v-for="(block, index) in layout.content" :key="`b${index}`" class="quickdoc-content" :class="`is-${block.kind}`">
        <!-- 标题块同样能长链接（`{@link}` 写在 `####` 那行里时 `docBlock` 也给 `parts`），
             只贴 `block.text` 的话这条链接既点不动、又不在链接行里（`buildQuickDocLayout` 已按 parts 去掉）。 -->
        <h4 v-if="block.kind === 'heading'">
          <template v-for="(part, partIndex) in block.parts ?? [{ text: block.text }]" :key="`h${index}-${String(partIndex)}`">
            <button v-if="partLink(part)" class="quickdoc-link" :class="`is-${partLink(part)?.kind}`" :title="partLink(part)?.target" @click="onLink(partLink(part))">{{ partLink(part)?.label }}</button>
            <template v-else>{{ partText(part) }}</template>
          </template>
        </h4>
        <pre v-else-if="block.kind === 'code'"><code>{{ block.text }}</code></pre>
        <!-- 正文里的引用**长在句子里**（上游是 content 那段 HTML 里的 `<a>`，
             `LspDocumentationData.kt:91-103`）：`parts` 有分段就逐段贴，链接段就是个内联按钮。 -->
        <p v-else>
          <template v-for="(part, partIndex) in block.parts ?? [{ text: block.text }]" :key="`p${index}-${String(partIndex)}`">
            <button v-if="partLink(part)" class="quickdoc-link" :class="`is-${partLink(part)?.kind}`" :title="partLink(part)?.target" @click="onLink(partLink(part))">{{ partLink(part)?.label }}</button>
            <template v-else>{{ partText(part) }}</template>
          </template>
        </p>
      </div>
      <table v-if="layout.sections.length" class="quickdoc-sections">
        <tbody>
          <tr v-for="(section, index) in layout.sections" :key="`s${index}`">
            <td class="quickdoc-section">{{ section.header }}</td>
            <td class="quickdoc-section-body">
              <template v-if="section.parts">
                <template v-for="(part, partIndex) in section.parts" :key="`sp${index}-${String(partIndex)}`">
                  <button v-if="partLink(part)" class="quickdoc-link" :class="`is-${partLink(part)?.kind}`" :title="partLink(part)?.target" @click="onLink(partLink(part))">{{ partLink(part)?.label }}</button>
                  <template v-else>{{ partText(part) }}</template>
                </template>
              </template>
              <template v-else>{{ section.content }}</template>
            </td>
          </tr>
        </tbody>
      </table>
      <!-- 进不了正文的链接（代码块里的 `<a>`、`@param` 重排掉的那些）仍可点；
           已经内联的那些不在这行重复出现（`buildQuickDocLayout` 已按 `parts` 去掉）。 -->
      <div v-if="layout.links.length" class="quickdoc-links">
        <button v-for="(link, index) in layout.links" :key="`l${index}`" class="quickdoc-link" :class="`is-${link.kind}`" :title="link.target" @click="onLink(link)">
          <span>{{ link.label }}</span><ExternalLink aria-hidden="true" v-if="link.kind === 'external'" :size="iconSize.chip" />
        </button>
      </div>
      <figure v-for="(image, index) in layout.images" :key="`i${index}`" class="quickdoc-figure">
        <img v-if="imageSources[image.src]" :src="imageSources[image.src]" :alt="image.alt" />
        <figcaption v-else>{{ image.alt || image.src }}</figcaption>
      </figure>
      <div v-if="layout.external" class="quickdoc-bottom">
        <button class="quickdoc-link is-external" :title="layout.external.target" @click="emit('open-external')">
          <span>{{ layout.external.label }}</span><ExternalLink aria-hidden="true" :size="iconSize.chip" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 齿轮那两个开关的"开着"的样子：只改这一层，色值全部走令牌。
   `.quickdoc-*` 的其余规则在 `src/style.css`（对 `DocumentationHtmlUtil.getDocumentationPaneAdditionalCssRules`
   的翻译），这里不重复也不覆盖它们 —— 唯一的例外是这两个 ToggleAction 的选中态，
   上游文档面用的是 `ToggleIcon`（选中就带底色），本仓用同一对令牌表达：`--hover` 底 + `--bright` 字。 */
.icon-button.is-on { background: var(--hover); color: var(--bright); }
.icon-button.is-on:hover { background: var(--header-hover); }
</style>
