<script setup lang="ts">
// 项目结构对话框（IDEA `ShowStructureSettingsAction` → `SingleConfigurableEditor(project,
// ProjectStructureConfigurable.getInstance(project), SettingsDialog.DIMENSION_KEY)`）。
//
// 逐条对照的源码：
//   java/java-backend/resources/META-INF/JavaActions.xml:45-48
//     <action id="ShowProjectStructureSettings" class="com.intellij.ide.actions.ShowStructureSettingsAction">
//       <add-to-group group-id="FileMainSettingsGroup" anchor="after" relative-to-action="ShowSettings"/>
//       <add-to-group group-id="SettingsEntryPointGroup" anchor="before" relative-to-action="ShowSettings"/>
//   platform/platform-resources/src/keymaps/$default.xml:23-26  Ctrl+Alt+Shift+S
//   ShowStructureSettingsAction.java:26-32  用 `SingleConfigurableEditor` 打开 —— 即**模态对话框**
//   ProjectStructureConfigurable     左侧 `SidePanel` 分类（Project / Modules / Libraries /
//                                    Facets / Artifacts / SDKs / Global Libraries / Problems），
//                                    右侧是选中分类的编辑面板；底部是对话框的 确定/应用/取消。
//
// TaoCode 只有 Project / Modules / Libraries 三类有真实内容（分别是：项目设置；模块内容根 + 排除目录；
// 依赖库）。Facets / Artifacts / SDKs / Global Libraries / Problems 需要构件的概念，登记在
// docs/class-parity-todo.md —— 这里不渲染空分类。
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import ProjectStructurePane from './ProjectStructurePane.vue'
import type { Entry, JavaProjectSettings, ProjectSettings } from '../bridge'
import { iconSize } from '../uiIcons'
// 项目名的默认来源（上游 `ProjectNameProvider`：目录名；取不到退回路径），与实例目录模型同一模块。
import { defaultProjectName } from '../projectDirectories'

const props = defineProps<{
  settings: ProjectSettings | null
  root: string | null
  busy: boolean
}>()

const emit = defineEmits<{
  saveJava: [settings: JavaProjectSettings]
  saveProject: [patch: { excludedDirs: string[] }]
  browse: [field: 'jdkHome' | 'outputPath']
  close: []
}>()

type Category = 'project' | 'modules' | 'libraries'
const categories: Array<{ id: Category; label: string; hint: string }> = [
  { id: 'project', label: '项目', hint: 'SDK、语言级别与编译器输出' },
  { id: 'modules', label: '模块', hint: '内容根与排除目录' },
  { id: 'libraries', label: '库', hint: '依赖的路径与通配符' },
]
const category = ref<Category>('project')
const pane = ref<InstanceType<typeof ProjectStructurePane> | null>(null)
const title = computed(() => props.root ? (defaultProjectName(props.root) || props.root) : '未打开项目')

/** 对话框的 确定/应用 都走这里：面板自己判断脏值并 emit 保存，然后由 App 写回原生。 */
function apply(): boolean {
  if (props.busy || !props.settings) return false
  pane.value?.save()
  return true
}
// 确定 = 应用并关闭（IDEA 的 SingleConfigurableEditor 的 OK 语义）。模板表达式里不能写语句，
// 所以拆成一个方法。
function confirm() { if (apply()) emit('close') }
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="help-dialog ps-dialog" role="dialog" aria-modal="true" aria-label="项目结构">
      <header class="ps-dialog-head">
        <h2>项目结构</h2>
        <button type="button" class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" aria-hidden="true" /></button>
      </header>
      <div class="ps-dialog-body">
        <!-- IDEA 的 SidePanel：左侧分类，右侧详情。 -->
        <nav class="ps-side" aria-label="项目结构分类">
          <button
            v-for="entry in categories"
            :key="entry.id"
            type="button"
            class="ps-side-item"
            :aria-current="category === entry.id ? 'true' : undefined"
            :class="{ active: category === entry.id }"
            :title="entry.hint"
            @click="category = entry.id"
          >{{ entry.label }}</button>
          <p class="ps-side-note">Facets / 构件 / SDK 列表需要构件概念，尚未移植。</p>
        </nav>
        <div class="ps-detail">
          <p v-if="!settings" class="section-description">尚未打开项目。项目结构随项目保存，请先打开一个项目。</p>
          <template v-else>
            <p class="ps-detail-title">{{ title }} · {{ categories.find(entry => entry.id === category)?.label }}</p>
            <ProjectStructurePane
              ref="pane"
              :settings="settings"
              :root="root"
              :busy="busy"
              :category="category"
              @save-java="emit('saveJava', $event)"
              @save-project="emit('saveProject', $event)"
              @browse="emit('browse', $event)"
            />
          </template>
        </div>
      </div>
      <footer class="ps-dialog-foot">
        <p class="field-hint">快捷键 Ctrl+Alt+Shift+S（`$default.xml:23-26`）。项目结构随项目保存。</p>
        <div class="ps-dialog-actions">
          <button type="button" class="primary-button" :disabled="busy || !settings" @click="confirm">确定</button>
          <button type="button" class="subtle-button" :disabled="busy || !settings" @click="apply()">应用</button>
          <button type="button" class="subtle-button" @click="emit('close')">取消</button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.ps-dialog { width: min(900px, 94vw); }
.ps-dialog-head { display: flex; align-items: center; gap: var(--space-2); }
.ps-dialog-head h2 { flex: 1; margin: 0; }
.ps-dialog-body { display: grid; grid-template-columns: minmax(0, 170px) minmax(0, 1fr); min-height: 380px; max-height: 62vh; }
.ps-side { display: flex; flex-direction: column; gap: 2px; padding: 4px; border-right: 1px solid var(--line); overflow: auto; }
/* `display: flex` 是补的：这是 `<button>`，UA 默认 inline-block，`justify-content` 在上面是
   空操作（与 `.tool-menu-item` style.css:318 同款，由 ui-icons 门禁一并盯住）。 */
.ps-side-item { display: flex; align-items: center; justify-content: flex-start; text-align: left; padding: 4px var(--space-2); border: 0; border-radius: var(--radius-xs); background: transparent; color: var(--secondary); font-size: 12px; }
.ps-side-item:hover { background: var(--hover); }
.ps-side-item.active { background: var(--selected); color: var(--bright); font-weight: 600; }
.ps-side-note { margin: auto 0 0; padding: var(--space-2); color: var(--muted); font-size: 10px; line-height: 1.5; }
.ps-detail { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; min-height: 0; padding: var(--space-3) 0 0 var(--space-4); overflow: auto; }
.ps-detail-title { margin: 0; color: var(--muted); font-size: 11px; }
.ps-dialog-foot { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); }
.ps-dialog-foot .field-hint { flex: 1; margin: 0; }
.ps-dialog-actions { display: flex; gap: var(--space-2); }
@media (max-width: 760px) { .ps-dialog-body { grid-template-columns: minmax(0, 1fr); max-height: none; } .ps-side { flex-direction: row; border-right: 0; border-bottom: 1px solid var(--line); } .ps-side-note { display: none; } }
</style>
