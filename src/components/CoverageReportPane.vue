<script setup lang="ts">
// 覆盖率报告面板（上游 `execution/coverage` 的「报告视图」那一半）——
// 报告位置识别 → 解析 → 按文件/包/类/方法四档切换展示。
//
// 为什么单独成组件：`RunConsole.vue` 里已有一块内联的覆盖率区（只走 `parseJacocoXml`、
// 三档聚合），而本轮 `src/coverageReport.ts` 已经补齐**三种格式**（JaCoCo / Cobertura / LCOV）
// 与**方法级**聚合。把「四档 + 三格式」都塞回 RunConsole 会继续撑大那个大组件
// （它归大组件 lane），所以新的展示面自成一个组件，RunConsole 想换过来只需把那一块
// 替换成 `<CoverageReportPane :instance="activeRecord.id" />`（见接线请求）。
//
// 取数链是真实的三步（与 RunConsole 同一条）：
//   1. `workspace.files` 拿整棵树 → `collectCoverageReportPath` 认出标准报告位置；
//   2. `file.read` 读回内容；
//   3. `parseCoverageReport` 按**格式分发**解析（JaCoCo/Cobertura 走 XML、LCOV 走 .info）。
// 展示：四档聚合的行模型在 `src/coverageReport.ts`（纯函数），这里只渲染与派发。
//
// `reportPath` 传了就跳过第 1 步（指定某一份报告，例如用户在文件树里点的那个）。
import { computed, ref } from 'vue'
import { request } from '../bridge'
import { setInstanceCoverage } from '../runInstances.ts'
import {
  COVERAGE_FORMAT_LABELS, collectCoverageReportPath, coverageAvailableGroupings,
  coverageViewSection, parseCoverageReport, type CoverageGrouping, type CoverageSummary,
} from '../coverageReport.ts'
import {
  COVERAGE_EXPORT_DIALOG_TITLE, COVERAGE_EXPORT_FILE_NAME, coverageReportExportAvailable,
  coverageReportExportPath, coverageReportHtml,
} from '../coverageExport.ts'

const props = defineProps<{
  /** 指定报告路径（工作区相对/绝对）；省略时自动在文件清单里认一个。 */
  reportPath?: string
  /** 关联的运行实例 id：读到报告后同时记进实例（`runInstances` 的那一格）。省略则只在本面板显示。 */
  instance?: number
  /** 桌面端才发请求（浏览器预览没有本地文件）。 */
  ready?: boolean
}>()
const emit = defineEmits<{ (event: 'loaded', summary: CoverageSummary): void }>()

/** 逐档最多画多少行（再多的给一句「还有 N 行」；报告可能几百个方法）。 */
const ROW_LIMIT = 40

const summary = ref<CoverageSummary | null>(null)
const grouping = ref<CoverageGrouping>('file')
const busy = ref(false)
const note = ref('')

const available = computed(() => coverageAvailableGroupings(summary.value))
const section = computed(() => coverageViewSection(summary.value, grouping.value))
const visibleRows = computed(() => section.value.rows.slice(0, ROW_LIMIT))
const extraRows = computed(() => Math.max(0, section.value.rows.length - ROW_LIMIT))
const formatLabel = computed(() => summary.value ? COVERAGE_FORMAT_LABELS[summary.value.format] : '')

/**
 * 读一份覆盖率报告。返回读到的小结（`null` = 工作区里没有报告）。
 * 抛错时把原因写进 `note`，面板不显示空表（空表会被误读成"0 行覆盖"）。
 */
async function load(reportPath = props.reportPath): Promise<CoverageSummary | null> {
  if (props.ready === false) { note.value = '浏览器预览没有本地文件，覆盖率报告只在桌面端可读。'; return null }
  if (busy.value) return null
  busy.value = true
  note.value = ''
  try {
    let report = reportPath ?? ''
    if (!report) {
      const listing = await request<{ files?: string[] }>('workspace.files')
      report = collectCoverageReportPath(listing?.files ?? []) ?? ''
    }
    if (!report) {
      summary.value = null
      if (props.instance) setInstanceCoverage(props.instance, null)
      note.value = '工作区里没有覆盖率报告：找过 build/reports/jacoco、target/site/jacoco、build/reports/kover 与 coverage/*.xml|*.info（Gradle/Maven 跑过 JaCoCo/Kover 或 LCOV 工具后才会生成）。'
      return null
    }
    const doc = await request<{ content?: string }>('file.read', { path: report })
    const parsed = parseCoverageReport(doc?.content ?? '', report)
    summary.value = parsed
    // 四档里文件级永远有（解析器保证），切到当前档若没内容就退回文件级 ——
    // 避免"上次按方法、这次换了份 LCOV 报告"时停在空表上。
    if (!coverageViewSection(parsed, grouping.value).available) grouping.value = 'file'
    if (parsed.files.length === 0 && parsed.coveredLines + parsed.missedLines === 0) {
      note.value = `报告里没有行覆盖数据（格式 ${formatLabel.value}）：可能是只含总览计数器、或这份报告是空的。`
    }
    if (props.instance) { setInstanceCoverage(props.instance, parsed); emit('loaded', parsed) }
    return parsed
  } catch (caught) {
    summary.value = null
    note.value = caught instanceof Error ? caught.message : String(caught)
    return null
  } finally {
    busy.value = false
  }
}

defineExpose({ load })

// ── 导出（上游 `GenerateCoverageReportAction` → `ExportToHTMLDialog`） ────────────────
// 上游：动作可用性门 `isReportGenerationAvailable`（`GenerateCoverageReportAction.java:51-58`），
// 落盘由各覆盖率引擎写出一棵 HTML 树。本仓没有采集引擎 ⇒ 把已解析的汇总写成一份自包含
// `index.html`（`src/coverageExport.ts`），目录选择与写盘走宿主既有两条通道
// （`dialog.pickDirectory` / `app.writeExportFiles`，后者只放行 .html/.htm/.txt）。
const exporting = ref(false)
const exportNote = ref('')
const canExport = computed(() => props.ready !== false && !exporting.value && coverageReportExportAvailable(summary.value))
async function exportReport() {
  if (props.ready === false) return
  const current = summary.value
  if (!coverageReportExportAvailable(current)) return
  exporting.value = true
  exportNote.value = ''
  try {
    if (!current) return  // 没有报告就没有可导出的内容（`coverageReportHtml` 要的是非空摘要）
    const directory = await request<string | null>('dialog.pickDirectory', { title: COVERAGE_EXPORT_DIALOG_TITLE, initial: '' })
    if (!directory) return
    const path = coverageReportExportPath(directory)
    await request('app.writeExportFiles', { files: [{ path, content: coverageReportHtml(current, { generatedAt: new Date() }) }] })
    exportNote.value = `已写入 ${path}`
  } catch (caught) {
    exportNote.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="coverage-pane" aria-label="覆盖率报告">
    <div class="coverage-head">
      <span class="coverage-title">覆盖率</span>
      <span v-if="summary" class="coverage-total" :title="summary.reportPath">
        行覆盖 {{ summary.percent }}%（{{ summary.coveredLines }} / {{ summary.coveredLines + summary.missedLines }} 行）
      </span>
      <span v-if="summary" class="coverage-format">{{ formatLabel }}</span>
      <span v-if="summary" class="coverage-path" :title="summary.reportPath">{{ summary.reportPath }}</span>
      <button type="button" class="coverage-action" :disabled="busy" aria-label="读取覆盖率报告" @click="load()">{{ busy ? '读取中…' : '重读报告' }}</button>
      <!-- 生成报告（上游 `GenerateCoverageReportAction`：先选目录再写出 HTML）。门与上游那条
           `isReportGenerationAvailable` 同义（没有报告内容就不可用），不可用时标题写明原因。 -->
      <button type="button" class="coverage-action" :disabled="!canExport" aria-label="生成覆盖率报告"
              :title="canExport ? `把当前报告的汇总写成 ${COVERAGE_EXPORT_FILE_NAME}` : '没有可导出的报告内容（先读到一份覆盖率报告）'"
              @click="exportReport()">{{ exporting ? '导出中…' : '生成报告' }}</button>
    </div>
    <div v-if="summary" class="coverage-modes" role="group" aria-label="覆盖率聚合方式">
      <button type="button" class="coverage-action" :class="{ active: grouping === 'file' }" :aria-pressed="grouping === 'file'" :disabled="!available.file" @click="grouping = 'file'">按文件 ({{ summary.files.length }})</button>
      <button type="button" class="coverage-action" :class="{ active: grouping === 'package' }" :aria-pressed="grouping === 'package'" :disabled="!available.package" @click="grouping = 'package'">按包 ({{ summary.packages.length }})</button>
      <button type="button" class="coverage-action" :class="{ active: grouping === 'class' }" :aria-pressed="grouping === 'class'" :disabled="!available.class" @click="grouping = 'class'">按类 ({{ summary.classes.length }})</button>
      <button type="button" class="coverage-action" :class="{ active: grouping === 'method' }" :aria-pressed="grouping === 'method'" :disabled="!available.method" @click="grouping = 'method'">按方法 ({{ summary.methods.length }})</button>
    </div>
    <ul v-if="visibleRows.length" class="coverage-rows" :aria-label="`逐${grouping === 'file' ? '文件' : grouping === 'package' ? '包' : grouping === 'class' ? '类' : '方法'}行覆盖`">
      <li v-for="row in visibleRows" :key="row.key" :title="row.detail || row.label">
        <span class="coverage-row-label">{{ row.label }}</span>
        <span v-if="row.detail" class="coverage-row-detail">{{ row.detail }}</span>
        <span class="coverage-row-pct">{{ row.coveredLines + row.missedLines > 0 ? `${row.percent}%` : '—' }}</span>
        <span class="coverage-row-counts">{{ row.coveredLines }}/{{ row.coveredLines + row.missedLines }}</span>
      </li>
    </ul>
    <p v-if="extraRows" class="coverage-note">还有 {{ extraRows }} 行未列出。</p>
    <p v-if="summary && summary.classesTruncated" class="coverage-note">类数超过上限，只解析了前 {{ summary.classes.length }} 个。</p>
    <p v-if="summary && summary.methodsTruncated" class="coverage-note">方法数超过上限，只解析了前 {{ summary.methods.length }} 个。</p>
    <p v-if="exportNote" class="coverage-note" role="status">{{ exportNote }}</p>
    <p v-if="note" class="coverage-note" role="status">{{ note }}</p>
  </div>
</template>

<style scoped>
/* 与 RunConsole 的覆盖率区同一套类名与观感（父组件那份 scoped 样式够不到子组件，
   所以按最小集抄一份，不复制整块）。 */
.coverage-pane { border-top: 1px solid var(--line); padding: var(--space-1) 0; }
.coverage-head { display: flex; align-items: center; gap: var(--space-2); padding: 0 var(--space-3); flex-wrap: wrap; }
.coverage-title { color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-size: 10px; }
.coverage-total { font-size: 11px; color: var(--text); }
.coverage-format { font-size: 10px; color: var(--muted); border: 1px solid var(--line); border-radius: var(--radius-xs); padding: 0 var(--space-1); }
.coverage-path { margin-left: auto; font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
.coverage-action { padding: 3px var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--elevated); color: var(--text); font-size: 11px; }
.coverage-action:disabled { color: var(--muted); opacity: .5; }
.coverage-action.active { border-color: var(--accent); color: var(--accent); }
.coverage-modes { display: flex; gap: var(--space-1); padding: var(--space-1) var(--space-3); }
.coverage-rows { max-height: 220px; overflow: auto; list-style: none; margin: 0; padding: 0; }
.coverage-rows > li { display: flex; align-items: baseline; gap: var(--space-2); padding: 1px var(--space-3); font: 11px/1.6 var(--font-mono); }
.coverage-row-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.coverage-row-detail { color: var(--muted); font-size: 10px; }
.coverage-row-pct { margin-left: auto; color: var(--text); }
.coverage-row-counts { color: var(--muted); }
.coverage-note { color: var(--muted); font-size: 11px; margin: 0; padding: 0 var(--space-3); }
</style>