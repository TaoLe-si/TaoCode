<script setup lang="ts">
// 「构建、执行、部署 › 调试器」页 —— 上游 `XDebuggerSettingsConfigurable` /
// `DebuggerGeneralConfigurable`（`platform/xdebugger-impl/src/com/intellij/xdebugger/impl/settings/`）。
//
// 页里有**四组**有真实消费点的开关（上游类名逐条写在 `src/settingsModel.ts` 与
// `src/debugSettingsStore.ts` 的字段注释里）：
//   · 数据视图（`XDebuggerDataViewSettings`）：隐藏 null 值、按名排序、行内值、库帧；
//   · 通用（`XDebuggerGeneralSettings`）：移断点确认、停在断点自动取消静音、求值对话框形态；
//   · 异常断点过滤器不在这里（它来自适配器声明的 capability，是会话内状态）；
//   · 悬停值提示（上游 `DataViewsConfigurableUi.kt:41-57` 那个 group）：显示值提示 + 查值延迟，
//     延迟格 `enabledIf(showTooltip.selected)` = 同文件 `:56` ⇒ 本仓在关闭提示时同样禁用输入；
//   · 编辑器/装订线（`XDebuggerGeneralSettings.java:16`/`:18`）：执行点滚动居中、运行到光标处手势。
// 消费者分别是 `src/debugDataView.ts`、`src/debugInlineValues.ts`、`src/debugBreakpointMute.ts`、
// `src/components/DebugEvaluateDialog.vue`（都经 `src/toolViewContext.ts` 的 debugView 进 DebugPanel），
// 加本轮接上的 `src/quickEvaluateHint.ts`（悬停求值）、`src/editorDebugLine.ts`（滚动居中）、
// `src/dbgRunToCursorGutter.ts`（装订线手势）。
//
// 后两组的存储与前三组不同：新键进不了 native 的 `GENERAL_SETTING_KEYS` 白名单
// （`native/settings_schema.hpp` 是保留文件，漏一个键会把**整次** general patch 拒掉），
// 所以走 `src/debugSettingsStore.ts` 的应用级 localStorage 键，**改一格即落盘、即生效**
// —— 上游 `debugger.xml` 本来就是应用级存储（`XDebuggerSettingManagerImpl.java:28`）。
//
// 已解锁的两格（2026-10-06 主代理把宿主接上后才渲染 —— 之前渲染就是假控件）：
//   · `hideDebuggerOnProcessTermination` / `myShowDebuggerOnBreakpoint`
//     （`XDebuggerGeneralSettings.java:14-15`）：判据在 `src/debugWindowPolicy.ts`，
//     工具窗口的 toFront / 收起由 `src/App.vue` 那两个 watch 落地（请求 12b W1 / 12c X2）。
//   · `autoExpressions`（`XDebuggerDataViewSettings.java:24`，上游 UI 见 `DataViewsConfigurableUi.kt:38`）：
//     上游那份 UI 也只是把它存下来，行为消费在语言插件的 Variables 视图（选中表达式自动进监视），
//     本仓的监视是面板显式加的，没有这条自动通道 ⇒ 不渲染。
import { computed } from 'vue'
import type { GeneralSettingsState } from '../settingsModel'
import { debuggerExtras } from '../debugSettingsStore'

defineProps<{ settings: GeneralSettingsState; busy?: boolean }>()

/** 上游 `enabledIf(showTooltip.selected)`（`DataViewsConfigurableUi.kt:56`）：关提示时延迟格不可编辑。 */
const delayDisabled = computed(() => !debuggerExtras.valueTooltipAutoShow)
</script>

<template>
  <h3>构建、执行、部署 › 调试器</h3>
  <fieldset class="settings-fields" :disabled="busy">
    <p class="field-hint">数据视图</p>
    <label class="checkbox-row"><input v-model="settings.debuggerHideNullValues" type="checkbox" /><span>隐藏值为 null 的变量与数组元素</span></label>
    <label class="checkbox-row"><input v-model="settings.debuggerSortByName" type="checkbox" /><span>按名称对变量排序（数组元素保持索引顺序）</span></label>
    <label class="checkbox-row"><input v-model="settings.debuggerShowValuesInline" type="checkbox" /><span>在编辑器行内显示变量值（<code>showValuesInline</code>；本仓为子集：当前帧第一个作用域，最多 8 条）</span></label>
    <label class="checkbox-row"><input v-model="settings.debuggerShowLibraryFrames" type="checkbox" /><span>调用堆栈中显示库帧（适配器标记为 <code>subtle</code> 的帧）</span></label>
    <p class="field-hint">通用</p>
    <label class="checkbox-row"><input v-model="settings.debuggerConfirmBreakpointRemoval" type="checkbox" /><span>移除断点前先确认（<code>confirmBreakpointRemoval</code>）</span></label>
    <label class="checkbox-row"><input v-model="settings.debuggerUnmuteOnStop" type="checkbox" /><span>停在断点时自动取消断点静音（<code>unmuteOnStop</code>）</span></label>
    <label class="checkbox-row">
      <span>求值对话框形态（<code>evaluationDialogMode</code>）</span>
      <select v-model="settings.debuggerEvaluationMode" aria-label="求值对话框形态">
        <option value="expression">表达式（单行）</option>
        <option value="codeFragment">代码片段（多行）</option>
      </select>
    </label>
  </fieldset>
  <fieldset class="settings-fields" :disabled="busy">
    <p class="field-hint">悬停值提示</p>
    <label class="checkbox-row"><input v-model="debuggerExtras.valueTooltipAutoShow" type="checkbox" /><span>鼠标停在变量上时显示值提示（<code>debugger.valueTooltipAutoShow</code>，快速求值的总开关）</span></label>
    <label class="checkbox-row">
      <span>查值延迟（<code>valueLookupDelay</code>，ms）</span>
      <input v-model.number="debuggerExtras.valueLookupDelay" type="number" min="0" max="10000" step="50" :disabled="delayDisabled" aria-label="悬停查值延迟" />
    </label>
    <p class="field-hint">数据视图</p>
    <label class="checkbox-row"><input v-model="debuggerExtras.scrollToCenter" type="checkbox" /><span>执行点换行时把该行滚到视口中间（<code>scrollToCenter</code>；关掉 = 只滚到可见）</span></label>
    <p class="field-hint">装订线手势</p>
    <label class="checkbox-row"><input v-model="debuggerExtras.runToCursorGestureEnabled" type="checkbox" /><span>暂停时把指针移到行号上出现「运行到光标处」，点击即执行（<code>runToCursorGestureEnabled</code>）</span></label>
    <p class="field-hint">工具窗口显隐</p>
    <label class="checkbox-row"><input v-model="debuggerExtras.showDebuggerOnBreakpoint" type="checkbox" /><span>停在断点时把 Debugger 工具窗口带到前面（<code>myShowDebuggerOnBreakpoint</code>，默认开；单步造成的暂停不算，见 <code>src/debugWindowPolicy.ts</code>）</span></label>
    <label class="checkbox-row"><input v-model="debuggerExtras.hideDebuggerOnProcessTermination" type="checkbox" /><span>被调试进程结束时收起 Debugger 页（<code>hideDebuggerOnProcessTermination</code>，默认关）</span></label>
  </fieldset>
</template>
