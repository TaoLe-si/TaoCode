<script setup lang="ts">
// 「外观」页（`preferences.lookFeel`，上游 AppearanceConfigurable）里由 `editor` / `general`
// 草稿驱动的那些控件 —— 从 `SettingsDialog.vue` 整块搬出来（宿主贴着机检上限，
// 见 tests/module-size.test.mjs 的登记）。搬出来的只有 markup 与它的 props/emits：
// 文案、绑定字段、控件结构、注释一个字没改；保存仍由对话框的「应用」统一做
// （这里改的就是对话框那份**同一个**草稿对象，与对话框内联的那些行同语义）。
//
// `<h3>外观</h3>` 与主题选择器留在宿主：主题切换是**对话框级** emit（点击位置要交给
// `src/themeRipple.ts` 的水纹扩散），与本节「改草稿、等应用」的控件不是同一件事。
//
// 为什么自带 `<style scoped>`：`SettingsDialog.vue` 给 `.settings-fields` / `.input-row` /
// `.checkbox-row` / `.field-hint` / `.settings-group-title` 写的那套样式在它自己的 scoped 块里，
// 子组件的元素拿不到宿主的 scope id（多根子树尤其如此）—— 不带上，这一节就没有任何样式。
// 下面每条都是宿主同名规则的**逐字拷贝**（几何、令牌、媒体查询都一致）；宿主那份仍留着，
// 给对话框里其余内联页面用。同款理由见 src/components/agent-settings/AgentSettingsSectionShell.vue。
import type { EditorSettings, GeneralSettingsState } from '../bridge'

defineProps<{
  /** 对话框那份 editor 草稿（同一个响应式对象）：这里勾选直接改它的字段。 */
  editor: EditorSettings
  /** 同一份 GeneralSettings —— 「支持屏幕阅读器」这一格在这一节里。 */
  general: GeneralSettingsState
  busy: boolean
  /** 对话框的 `useId()` 前缀：label/for 的配对与搬出前逐字一致。 */
  idPrefix: string
}>()
const emit = defineEmits<{ pickBackground: []; clearBackground: [] }>()
</script>

<template>
  <fieldset class="settings-fields" :disabled="busy" aria-label="缩放与界面密度">
    <div class="input-row">
      <label :for="`${idPrefix}-zoom`">缩放</label>
      <div class="zoom-row">
        <select :id="`${idPrefix}-zoom`" v-model.number="editor.uiZoomPercent">
          <option v-for="percent in [50, 70, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 350, 400]" :key="percent" :value="percent">{{ percent }}%</option>
        </select>
        <button type="button" class="subtle-button" :disabled="editor.uiZoomPercent === 100" @click="editor.uiZoomPercent = 100">重置</button>
      </div>
    </div>
    <label class="checkbox-row"><input v-model="editor.compactMode" type="checkbox" /><span>紧凑模式</span></label>
    <label class="checkbox-row"><input v-model="editor.fullPathsInWindowHeader" type="checkbox" /><span>在窗口标题中始终显示完整路径</span></label>
    <!-- 「状态栏」这一行以前不存在：`showStatusBar` 又被 native 的键白名单漏掉
         （native/settings_schema.hpp 的 EDITOR_SETTING_KEYS 注释有前后），于是两头都没出口。
         上游出处：AppearanceOptionsTopHitProvider.kt:33 `cdShowStatusBar`，groupName = viewOptionGroupName。 -->
    <label class="checkbox-row"><input v-model="editor.showStatusBar" type="checkbox" /><span>状态栏</span></label>
  </fieldset>
  <h4 class="settings-group-title">辅助功能与字体</h4>
  <fieldset class="settings-fields" :disabled="busy">
    <label class="checkbox-row"><input v-model="general.supportScreenReaders" type="checkbox" /><span>支持屏幕阅读器</span></label>
  </fieldset>
  <fieldset class="settings-fields" :disabled="busy">
    <label class="checkbox-row"><input v-model="editor.useContrastScrollbars" type="checkbox" /><span>使用对比度滚动条</span></label>
    <div class="input-row">
      <label :for="`${idPrefix}-colorblind`">针对色觉缺陷调整颜色</label>
      <select :id="`${idPrefix}-colorblind`" v-model="editor.colorBlindness">
        <option value="none">不调整</option>
        <option value="deuteranopia">绿色盲（deuteranopia）</option>
        <option value="protanopia">红色盲（protanopia）</option>
        <option value="tritanopia">蓝黄色盲（tritanopia）</option>
      </select>
    </div>
    <div class="input-row">
      <label :for="`${idPrefix}-font-family`">界面字体</label>
      <input :id="`${idPrefix}-font-family`" v-model.trim="editor.uiFontFamily" type="text" placeholder="留空使用系统字体" :maxlength="120" />
    </div>
    <div class="input-row">
      <label :for="`${idPrefix}-font-size`">界面字号 <span class="field-hint">（像素）</span></label>
      <input :id="`${idPrefix}-font-size`" v-model.number="editor.uiFontSize" type="number" min="9" max="24" step="1" />
    </div>
  </fieldset>
  <div class="input-row">
    <label>背景图像</label>
    <div class="zoom-row">
      <button type="button" class="subtle-button" :disabled="busy" @click="emit('pickBackground')">{{ editor.backgroundImagePath ? '更换图像…' : '背景图像…' }}</button>
      <button v-if="editor.backgroundImagePath" type="button" class="subtle-button" :disabled="busy" @click="emit('clearBackground')">移除</button>
    </div>
  </div>
  <p v-if="editor.backgroundImagePath" class="field-hint restore-hint">当前：{{ editor.backgroundImagePath }}</p>
  <div v-if="editor.backgroundImagePath" class="settings-fields">
    <div class="input-row">
      <label :for="`${idPrefix}-bg-fill`">显示方式</label>
      <select :id="`${idPrefix}-bg-fill`" v-model="editor.backgroundImageFill">
        <option value="scale">缩放填充</option>
        <option value="tile">平铺</option>
        <option value="center">居中原始大小</option>
      </select>
    </div>
    <label class="checkbox-row"><input v-model="editor.backgroundImageKeepRatio" type="checkbox" :disabled="editor.backgroundImageFill !== 'scale'" /><span>保持宽高比（缩放模式下）</span></label>
    <div class="input-row">
      <label :for="`${idPrefix}-bg-opacity`">不透明度 <span class="field-hint">（%）</span></label>
      <input :id="`${idPrefix}-bg-opacity`" v-model.number="editor.backgroundImageOpacity" type="number" min="0" max="100" step="5" />
    </div>
  </div>
  <h4 class="settings-group-title">演示模式</h4>
  <fieldset class="settings-fields" :disabled="busy">
    <label class="checkbox-row"><input v-model="editor.presentationMode" type="checkbox" /><span>演示模式</span></label>
    <div class="input-row">
      <label :for="`${idPrefix}-pres-size`">演示字号 <span class="field-hint">（像素）</span></label>
      <input :id="`${idPrefix}-pres-size`" v-model.number="editor.presentationModeFontSize" type="number" min="12" max="72" step="2" />
    </div>
  </fieldset>
  <h4 class="settings-group-title">主菜单</h4>
  <fieldset class="settings-fields" :disabled="busy">
    <div class="input-row">
      <!-- 条目顺序 = `MainMenuDisplayMode` 的**声明顺序**（AppearanceConfigurable.kt:509
           `CollectionComboBoxModel(MainMenuDisplayMode.entries)`），显示文本 = 各档的
           `description`（MainMenuDisplayMode.kt:14-16 → CoreBundle.properties:157-159）。
           标签文本 = IdeBundle.properties:3282 `main.menu.combobox.label=Main menu:`。 -->
      <label :for="`${idPrefix}-main-menu`">主菜单</label>
      <select :id="`${idPrefix}-main-menu`" v-model="editor.mainMenuDisplayMode">
        <option value="hamburger">隐藏在汉堡按钮下方</option>
        <option value="merged">与主工具栏合并</option>
        <option value="separate">显示在主工具栏上方</option>
      </select>
    </div>
  </fieldset>
  <h4 class="settings-group-title">树视图</h4>
  <fieldset class="settings-fields" :disabled="busy">
    <label class="checkbox-row"><input v-model="editor.showTreeIndentGuides" type="checkbox" /><span>显示缩进参考线</span></label>
    <label class="checkbox-row"><input v-model="editor.compactTreeIndents" type="checkbox" /><span>使用更小的缩进</span></label>
    <!-- cdExpandNodesWithSingleClick (UISettingsState.kt:141, default false);
         bundle: checkbox.expand.node.with.single.click + ".comment". -->
    <label class="checkbox-row"><input v-model="editor.expandNodesWithSingleClick" type="checkbox" /><span>单击展开节点</span></label>
  </fieldset>
  <h4 class="settings-group-title">UI 选项</h4>
  <fieldset class="settings-fields" :disabled="busy">
    <label class="checkbox-row"><input v-model="editor.smoothScrolling" type="checkbox" /><span>平滑滚动</span></label>
    <label class="checkbox-row"><input v-model="editor.keepPopupsForToggles" type="checkbox" /><span>切换条目时保持弹出窗口打开</span></label>
    <label class="checkbox-row"><input v-model="editor.dndWithPressedAltOnly" type="checkbox" /><span>仅按下 Alt 时拖放</span></label>
    <label class="checkbox-row"><input v-model="editor.showIconsInMenus" type="checkbox" /><span>在菜单项中显示图标</span></label>
    <!-- cdDifferentiateProjects; bundle: checkbox.use.solution.colors.in.main.toolbar
         + text.use.solution.colors.in.main.toolbar. -->
    <label class="checkbox-row"><input v-model="editor.differentiateProjects" type="checkbox" /><span>在主工具栏中使用项目颜色</span></label>
  </fieldset>
  <h4 class="settings-group-title">工具窗口</h4>
  <fieldset class="settings-fields" :disabled="busy">
    <label class="checkbox-row"><input v-model="editor.showToolWindowBars" type="checkbox" /><span>显示工具窗口条</span></label>
    <label class="checkbox-row"><input v-model="editor.showToolWindowNames" type="checkbox" /><span>显示工具窗口名称</span></label>
    <label class="checkbox-row"><input v-model="editor.showToolWindowNumbers" type="checkbox" /><span>显示工具窗口编号</span></label>
    <label class="checkbox-row"><input v-model="editor.rememberSizeForEachToolWindow" type="checkbox" /><span>记住每个工具窗口的大小</span></label>
    <label class="checkbox-row"><input v-model="editor.leftSideBySide" type="checkbox" /><span>左侧并列布局</span></label>
    <label class="checkbox-row"><input v-model="editor.rightSideBySide" type="checkbox" /><span>右侧并列布局</span></label>
    <label class="checkbox-row"><input v-model="editor.wideScreenSupport" type="checkbox" /><span>宽屏工具窗口布局</span></label>
  </fieldset>
</template>

<style scoped>
/* 以下规则逐字拷贝自 SettingsDialog.vue 的同名规则（见文件头：子组件拿不到宿主的 scoped 样式）。 */
.settings-fields { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; border: 0; padding: 0; margin: 0; }
.input-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2) var(--space-4); }
.input-row label, .field-label { color: var(--text); font-weight: 500; }
.input-row input, .input-row select { width: 118px; max-width: 100%; min-width: 0; min-height: var(--ctrl-height); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: inherit; }
.zoom-row { display: flex; align-items: center; gap: var(--space-2); }
.zoom-row select { width: 90px; min-height: var(--ctrl-height); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: inherit; }
.zoom-row .subtle-button { min-height: var(--ctrl-height); font-size: 11px; }
.field-hint { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; font-weight: 400; }
/* A field followed by its hint sits tight against it; the group stays apart from the next row. */
.field-label + .field-hint, .settings-fields :is(input, select, textarea) + .field-hint { margin-top: calc(var(--space-3) * -1 + 2px); }
.checkbox-row { display: flex; align-items: flex-start; gap: var(--space-2); cursor: pointer; }
.checkbox-row input { flex-shrink: 0; width: var(--icon-size-checkbox); height: var(--icon-size-checkbox); margin: 2px 0 0; accent-color: var(--accent); }
.checkbox-row span { min-width: 0; overflow-wrap: anywhere; }
.settings-group-title { margin: var(--space-6) 0 var(--space-3); padding-bottom: var(--space-2); border-bottom: 1px solid var(--line-strong); color: var(--bright); font-size: 13px; font-weight: 650; }
.restore-hint { padding-left: var(--space-5); }
@media (max-width: 560px) {
  .restore-hint { padding-left: 0; }
}
</style>
