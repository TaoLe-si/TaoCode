<script setup lang="ts">
// Editor › Color Scheme 整页 —— 上游 `ColorAndFontOptions`（页面注册
// `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1749-1751`，
// `id="reference.settingsdialog.IDE.editor.colors"`、`groupId="editor"`、`groupWeight="180"`）。
//
// 面板结构照上游 `NewColorAndFontPanel.java:38-66`：上=方案条（`SchemesPanel.java`），
// 中=颜色项列表（`OptionsPanelImpl.java` + `ColorOptionsTree.java`），下=预览分栏
// （`PreviewPanel`，`:56-58` 只有页面带演示文本才出现 —— 本仓演示文本由页面自己给，
// 对应上游 `ColorSettingsPage.java:52` 的 `getDemoText`）。
//
// **画了哪些行、为什么不画别的**（假控件禁令）：
//   · 每一行都对应一个**真实生效**的 CSS 自定义属性（逐项证据在 `src/colorScheme.ts` 的
//     `consumer` 字段），覆盖表存 localStorage 并以注入样式回灌编辑器（`src/colorSchemeStore.ts`）。
//   · 上游行内的粗体/斜体/删除线/效果线（`ColorAndFontDescriptionPanel.kt:107-108,120-121`）
//     在本仓没有 var 通道（字重/斜体是 `src/editorTheme.ts` 与 `src/editorSemanticColors.ts` 的
//     硬编码字面量，本代理无权改）⇒ **不画**；彩虹括号五档（`src/editorBrackets.ts` 硬编码 hex）同理不画。
//     接线请求见 docs/wiring-requests-2026-10-06-colorscheme.md（W-2 把它变成可画的行）。
//   · 上游的导入按钮（`ColorSchemeImporter`）需要文件打开通道、导出按钮（`ColorSchemeExporter.java:9`）
//     需要文件保存通道，本仓页面拿不到 ⇒ 导出降级为「复制方案 XML 文本」（走既有
//     `src/clipboard.ts:35` 的 `copyToClipboard`），导入不画。
//
// 本页**挂载在** `SettingsDialog.vue` + `settingsTreeMeta.ts`（别的代理在改，均只读）：
// 接线请求 W-1 给了可照抄的整段。挂载前本页未被任何地方渲染 ⇒ 已在 `.tools/orphan-baseline.txt`
// 登记一行并写明理由；挂载后被接上，那一行可删。
import { computed, onMounted, ref } from 'vue'
import { Copy, RotateCcw, Trash2 } from 'lucide-vue-next'
import {
  COLOR_ATTRIBUTE_ITEMS,
  type ColorScheme,
  type ColorSchemeTheme,
  duplicateScheme,
  ensureEditableScheme,
  filterColorAttributeItems,
  removeScheme,
  resetSchemeOverrides,
  revertAttributeOverride,
  schemeChain,
  schemeDisplayName,
  schemeToXml,
  setAttributeOverride,
} from '../colorScheme.ts'
import {
  type ColorSchemeState,
  applyColorScheme,
  loadColorSchemeState,
  saveColorSchemeState,
} from '../colorSchemeStore.ts'
import { copyToClipboard } from '../clipboard.ts'
import ColorChooserDialog from './ColorChooserDialog.vue'
import { iconSize } from '../uiIcons'

defineProps<{ busy?: boolean }>()

const state = ref<ColorSchemeState>(loadColorSchemeState())
const query = ref('')
const chooser = ref<{ externalKey: string; label: string; initial: string } | null>(null)
const notice = ref('')

/** 当前界面主题（决定编辑只读基座时先派生哪一份可编辑副本）。 */
function currentTheme(): ColorSchemeTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function currentBaseName(): string {
  return currentTheme() === 'dark' ? 'TaoCode Dark' : 'TaoCode Light'
}

const activeScheme = computed<ColorScheme | null>(
  () => state.value.schemes.find(s => s.name === state.value.active) ?? null,
)

const schemeOptions = computed(() => state.value.schemes.map(s => ({ value: s.name, label: schemeDisplayName(s.name), readOnly: s.readOnly })))

/** 继承行：上游把 parent 记在根属性 `parent_scheme`（`AbstractColorsScheme.java:81,593`），这里只读展示。 */
const inheritLabel = computed(() => {
  const scheme = activeScheme.value
  if (!scheme) return '无（不覆盖基座）'
  if (!scheme.inheritFrom) return '基座主题（不继承其他方案）'
  return schemeDisplayName(scheme.inheritFrom)
})

/** 上游颜色项树带速度搜索（`ColorOptionsTree.java:58`）；本仓用可见搜索框做同一件事（判词要求）。 */
const groups = computed(() => {
  const filtered = filterColorAttributeItems(COLOR_ATTRIBUTE_ITEMS, query.value)
  return filtered.map(g => ({
    ...g,
    label: g.group === 'general' ? '常规' : '默认语言',
    entries: g.entries.map(item => ({
      item,
      overridden: !!activeScheme.value?.overrides[item.externalKey],
      inheritedFrom: inheritedTag(item.externalKey),
    })),
  }))
})

/** 「继承自」标签：沿链找第一个定义了该键的方案（上游的 fallback 链 = getAttributes 委托）。 */
function inheritedTag(externalKey: string): string {
  if (!activeScheme.value) return ''
  const chain = schemeChain(state.value.schemes, activeScheme.value.name)
  for (let index = chain.length - 2; index >= 0; index--) {
    if (chain[index].overrides[externalKey]) return `继承自 ${schemeDisplayName(chain[index].name)}`
  }
  return '基座主题默认'
}

const modifiedCount = computed(() => Object.keys(activeScheme.value?.overrides ?? {}).length)

function persist(next: ColorSchemeState): void {
  state.value = next
  saveColorSchemeState(next)
  applyColorScheme(next)
}

/** 选中方案（上游 `SchemesPanel.java:131-145`：切换后刷新颜色项表 + 预览）。 */
function selectScheme(name: string): void {
  persist({ ...state.value, active: name })
  notice.value = ''
}

function readVar(cssVar: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim()
}

/** 编辑前保证落在可编辑副本上（`ColorAndFontOptions.java:386-388`）。 */
function editableTarget(): { schemes: ColorScheme[]; name: string } {
  const name = state.value.active || currentBaseName()
  return ensureEditableScheme(state.value.schemes, name)
}

function openChooser(externalKey: string, label: string, cssVar: string): void {
  chooser.value = { externalKey, label, initial: readVar(cssVar) }
}

function confirmColor(color: string): void {
  const pending = chooser.value
  chooser.value = null
  if (!pending) return
  const editable = editableTarget()
  const schemes = setAttributeOverride(editable.schemes, editable.name, pending.externalKey, color)
  persist({ ...state.value, active: editable.name, schemes })
  if (editable.name !== state.value.active) notice.value = `基座是只读的，已按上游规则派生可编辑副本「${schemeDisplayName(editable.name)}」。`
}

function revert(itemExternalKey: string): void {
  if (!activeScheme.value || activeScheme.value.readOnly) return
  persist({ ...state.value, schemes: revertAttributeOverride(state.value.schemes, activeScheme.value.name, itemExternalKey) })
}

function resetAll(): void {
  if (!activeScheme.value || activeScheme.value.readOnly) return
  persist({ ...state.value, schemes: resetSchemeOverrides(state.value.schemes, activeScheme.value.name) })
  notice.value = '已重置为继承值。'
}

function duplicate(): void {
  const name = state.value.active || currentBaseName()
  const result = duplicateScheme(state.value.schemes, name)
  if (!result) return
  persist({ ...state.value, active: result.name, schemes: result.schemes })
}

function remove(): void {
  const scheme = activeScheme.value
  if (!scheme || scheme.readOnly) return
  const schemes = removeScheme(state.value.schemes, scheme.name)
  const fallback = scheme.inheritFrom && schemes.some(s => s.name === scheme.inheritFrom) ? scheme.inheritFrom : ''
  persist({ ...state.value, active: fallback, schemes })
}

async function copyXml(): Promise<void> {
  const scheme = activeScheme.value
  if (!scheme) return
  await copyToClipboard(schemeToXml(scheme))
  notice.value = '方案 XML 已复制到剪贴板（上游导出为 .icls 文件，本仓页面没有文件保存通道）。'
}

onMounted(() => {
  // 页面被渲染时把存档方案回灌到文档（启动期的全局应用是接线请求 W-3 的目标）。
  applyColorScheme(state.value)
})
</script>

<template>
  <div class="color-scheme-page">
    <h3>编辑器 › 配色方案</h3>
    <p class="section-description">
      对应 IDEA Settings › Editor › Color Scheme（注册 id
      <code>reference.settingsdialog.IDE.editor.colors</code>）。每一行都写进方案覆盖表并即时作用于编辑器；
      上游本行的粗体/斜体/效果档在本仓没有生效通道，故不渲染（理由见文件头）。
    </p>

    <fieldset class="scheme-bar" :disabled="busy">
      <label class="scheme-select">
        <span>配色方案</span>
        <select :value="state.active" @change="selectScheme(($event.target as HTMLSelectElement).value)">
          <option value="">跟随基座（不覆盖）</option>
          <option v-for="option in schemeOptions" :key="option.value" :value="option.value">
            {{ option.label }}{{ option.readOnly ? '（只读）' : '' }}
          </option>
        </select>
      </label>
      <p class="scheme-inherit">
        继承自：<strong>{{ inheritLabel }}</strong>
        <span v-if="activeScheme">· 已改 {{ modifiedCount }} 项</span>
      </p>
      <div class="scheme-toolbar" role="toolbar" aria-label="方案操作">
        <button type="button" title="复制为新方案" aria-label="复制为新方案" @click="duplicate"><Copy :size="iconSize.action" /></button>
        <button
          type="button" title="重置此方案的全部覆盖" aria-label="重置此方案的全部覆盖"
          :disabled="!activeScheme || activeScheme.readOnly || !modifiedCount" @click="resetAll"
        ><RotateCcw :size="iconSize.action" /></button>
        <button
          type="button" title="删除此方案" aria-label="删除此方案"
          :disabled="!activeScheme || activeScheme.readOnly" @click="remove"
        ><Trash2 :size="iconSize.action" /></button>
        <button
          type="button" class="copy-xml" :disabled="!activeScheme || !modifiedCount" @click="copyXml"
        >复制方案 XML</button>
      </div>
      <p v-if="notice" class="field-hint" role="status">{{ notice }}</p>
    </fieldset>

    <label class="scheme-search">
      <span class="visually-hidden">搜索颜色项</span>
      <input v-model="query" type="search" placeholder="搜索颜色项" aria-label="搜索颜色项" />
    </label>

    <div class="attribute-list" role="list">
      <section v-for="group in groups" :key="group.label" class="attribute-group">
        <h4>{{ group.label }}</h4>
        <div v-for="row in group.entries" :key="row.item.id" class="attribute-row" role="listitem">
          <button
            type="button" class="swatch" :style="{ background: `var(${row.item.cssVar})` }"
            :title="`修改「${row.item.label}」的颜色`" :aria-label="`修改「${row.item.label}」的颜色`"
            @click="openChooser(row.item.externalKey, row.item.label, row.item.cssVar)"
          ></button>
          <span class="attribute-name">{{ row.item.label }}</span>
          <code class="attribute-key">{{ row.item.externalKey }}</code>
          <span v-if="row.overridden" class="attribute-flag">已改</span>
          <span v-else class="attribute-inherit">{{ row.inheritedFrom }}</span>
          <button
            v-if="row.overridden" type="button" class="attribute-revert"
            :title="`还原「${row.item.label}」为继承值`" :aria-label="`还原「${row.item.label}」为继承值`"
            @click="revert(row.item.externalKey)"
          ><RotateCcw :size="iconSize.dense" /></button>
        </div>
        <p v-if="!group.entries.length && query" class="field-hint">没有匹配「{{ query }}」的颜色项。</p>
      </section>
      <p v-if="!groups.length && query" class="field-hint">没有匹配「{{ query }}」的颜色项。</p>
    </div>

    <section class="scheme-preview" aria-label="配色预览">
      <pre class="preview-code"><span class="tok-comment">// 预览用上表当前生效的颜色渲染</span>
<span class="tok-keyword">function</span> <span class="tok-function">render</span>(<span class="tok-type">Doc</span> <span class="tok-property">doc</span>, <span class="tok-parameter">level</span>: <span class="tok-number">2</span>) <span class="tok-operator">{</span>
  <span class="tok-keyword">return</span> <span class="tok-meta">@</span>doc.<span class="tok-property">highlight</span>(<span class="tok-string">"scheme"</span>)<span class="tok-operator">;</span>
<span class="tok-operator">}</span></pre>
    </section>

    <p class="field-hint">
      颜色值写进用户级方案表并即时回灌编辑器；上游的行级字体样式与彩虹括号档位覆盖需要
      把 <code>src/editorTheme.ts</code> / <code>src/editorBrackets.ts</code> 的字面量改成变量通道（接线请求里已列）。
    </p>

    <ColorChooserDialog
      v-if="chooser" :initial="chooser.initial" :enable-opacity="false"
      @confirm="confirmColor" @cancel="chooser = null"
    />
  </div>
</template>

<style scoped>
.color-scheme-page { display: flex; flex-direction: column; gap: 10px; }
.scheme-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 0; padding: 8px 10px; border: 1px solid var(--line); }
.scheme-select { display: inline-flex; align-items: center; gap: 6px; }
.scheme-select select { min-width: 220px; }
.scheme-inherit { margin: 0; color: var(--secondary); font-size: 12px; }
.scheme-toolbar { display: inline-flex; align-items: center; gap: 2px; }
.scheme-toolbar > button { display: inline-flex; align-items: center; padding: 4px; border: 0; background: transparent; color: inherit; cursor: pointer; }
.scheme-toolbar .copy-xml { padding: 4px 8px; color: var(--accent); }
button:disabled { opacity: .45; cursor: default; }
.scheme-search input { min-width: 240px; }
.visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.attribute-list { display: flex; flex-direction: column; max-height: 44vh; overflow: auto; border: 1px solid var(--line); }
.attribute-group { display: flex; flex-direction: column; }
.attribute-group h4 { margin: 0; padding: 6px 10px; font-size: 12px; color: var(--muted); background: var(--panel); border-bottom: 1px solid var(--line); position: sticky; top: 0; }
.attribute-row { display: grid; grid-template-columns: 22px minmax(120px, 1fr) auto auto 26px; align-items: center; gap: 8px; padding: 3px 10px; border-bottom: 1px solid var(--line); }
.attribute-row .swatch { width: 18px; height: 18px; padding: 0; border: 1px solid var(--line-strong); cursor: pointer; }
.attribute-name { color: var(--text); }
.attribute-key { color: var(--muted); font-size: 11px; }
.attribute-flag { color: var(--accent); font-size: 11px; }
.attribute-inherit { color: var(--muted); font-size: 11px; }
.attribute-revert { display: inline-flex; justify-content: center; padding: 3px; border: 0; background: transparent; color: var(--secondary); cursor: pointer; }
.scheme-preview { border: 1px solid var(--line); background: var(--editor); padding: 8px 10px; }
.preview-code { margin: 0; font-family: var(--font-mono); font-size: 12px; line-height: 1.6; color: var(--text); }
.tok-comment { color: var(--syntax-comment); }
.tok-keyword { color: var(--syntax-keyword); }
.tok-string { color: var(--syntax-string); }
.tok-number { color: var(--syntax-number); }
.tok-type { color: var(--syntax-type); }
.tok-function { color: var(--syntax-function); }
.tok-meta { color: var(--syntax-meta); }
.tok-property { color: var(--syntax-property); }
.tok-parameter { color: var(--syntax-property); }
.tok-operator { color: var(--syntax-operator); }
.field-hint { margin: 0; color: var(--muted); font-size: 12px; }
</style>
