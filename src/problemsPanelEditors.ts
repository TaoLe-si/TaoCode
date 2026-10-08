// 问题面板工具栏上那几份「编辑器弹层」的编辑态与提交：忽略规则 / 纯文本覆盖清单 / 分析范围。
//
// 三者是同一副形状 —— 打开弹层 → 改一份本地副本 → 提交写回各自模块的设置状态，重置则同时清掉
// 模块状态与本地副本；这一族只碰设置状态，不碰问题表（过滤/排序/分组规则在 src/problemsView.ts）、
// 也不碰渲染（模板只读这里抛出的 ref 与动作）。面板因此只留一行装配。
import { computed, ref, watch } from 'vue'
// 分析忽略（上游 `AnalysisIgnoreService`）：规则编辑与逐文件忽略都落在这里，问题表本身
// 已在 src/problems.ts 聚合前过滤，所以保存后面板当场变短。
import { clearAnalysisIgnore, ignorePatternsText, ignoredFiles, saveIgnorePatterns, toggleIgnoredFile } from './analysisIgnore.ts'
// 按文件覆盖文件类型（上游 `OverrideFileTypeAction`/`ReverteOverrideFileTypeAction` +
// `PersistentFileSetManager`，见 src/fileTypeOverrides.ts）：标成纯文本的文件退出语言分析，
// 聚合门控在 src/problems.ts，恢复入口就是这份覆盖清单。
import { clearFileTypeOverrides, fileSetPaths, overrideFileType, revertFileType } from './fileTypeOverrides.ts'
// 分析范围（上游 `BaseAnalysisActionDialog` + `AnalysisUIOptions`，见 src/analysisScope.ts）：
// 「检查代码（整工程）」跑之前按这里的范围过滤，范围外的文件不进问题表。
import { analysisScope, resetAnalysisScope, scopeSummary, scopeText, setAnalysisScopeFromText } from './analysisScope.ts'

/** 面板上那几个弹层的编辑态与动作（在组件 setup 里调一次，watch 随组件一起收摊）。 */
export function createProblemsPanelEditors() {
  // 忽略规则编辑（上游 `AnalysisIgnoreFileWriter` 的写入面）：保存后问题表即时重算。
  const rulesOpen = ref(false)
  const rulesText = ref(ignorePatternsText.value)
  watch(ignorePatternsText, value => { rulesText.value = value })
  const ignoredCount = computed(() => ignoredFiles.value.length)
  function saveRules() { saveIgnorePatterns(rulesText.value); rulesOpen.value = false }
  function restoreAll() { clearAnalysisIgnore(); rulesText.value = ''; rulesOpen.value = false }
  function ignoreFile(path: string) { toggleIgnoredFile(path) }

  // 文件类型覆盖（`OverrideFileTypeAction`）：逐行「纯文本」按钮 + 工具栏里的覆盖清单。
  const overrideOpen = ref(false)
  const overriddenFiles = computed(() => fileSetPaths())
  function markPlainText(path: string) { overrideFileType(path) }
  function revertOverride(path: string) { revertFileType(path) }
  function clearOverrides() { clearFileTypeOverrides() }

  // 分析范围（`AnalysisUIOptions.SCOPE_TYPE` + `CUSTOM_SCOPE_NAME` 的本仓形态）：两行 glob。
  const scopeOpen = ref(false)
  const scopeIncludeText = ref(scopeText(analysisScope.value.include))
  const scopeExcludeText = ref(scopeText(analysisScope.value.exclude))
  const scopeLabel = computed(() => scopeSummary(analysisScope.value))
  function saveScope() {
    setAnalysisScopeFromText(scopeIncludeText.value, scopeExcludeText.value)
    scopeOpen.value = false
  }
  function clearScope() {
    resetAnalysisScope()
    scopeIncludeText.value = ''
    scopeExcludeText.value = ''
    scopeOpen.value = false
  }

  return {
    rulesOpen, rulesText, ignoredCount, saveRules, restoreAll, ignoreFile,
    overrideOpen, overriddenFiles, markPlainText, revertOverride, clearOverrides,
    scopeOpen, scopeIncludeText, scopeExcludeText, scopeLabel, saveScope, clearScope,
  }
}
