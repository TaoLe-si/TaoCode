// 文件颜色在标签页上的落点（IDEA `EditorTabColorProviderImpl` 那一层）。
//
// 源码的分工：`FileColorManager` 负责「这个文件是什么颜色」，`EditorTabColorProvider` 负责
// 「标签页用它上色」。本仓把这两层合在这个小模块里：算颜色的逻辑在 `fileColors.ts`（纯函数、
// 可单测），这里只负责把「当前设置 + 当前项目」接成标签页能直接用的 CSS 变量。
//
// 为什么返回 `var(--file-color-xxx)` 而不是色值：源码里存的是**颜色名**（`getColorID()`），
// 七个具名色各自带明暗两套（`ourDefaultColors` 的 `JBColor(light, dark)`）—— 换主题要跟着换。
// 所以七色落在 tokens.css 的主题块里，这里只给变量名。
import { computed, type Ref } from 'vue'
import { FILE_COLOR_NAMES, normalizeFileColors, resolveFileColor, tabFileColorEnabled, type FileColorName } from './fileColors.ts'
import type { EditorSettings, ProjectSettings, Workspace } from './bridge'

export interface FileColorHostDeps {
  editorSettings: Ref<EditorSettings>
  projectSettings: Ref<ProjectSettings>
  workspace: Ref<Workspace | null>
}

export function createFileColorHost(deps: FileColorHostDeps) {
  const { editorSettings, projectSettings, workspace } = deps

  // 归一化放在 computed 里：作用域被改名/删除后，颜色表里指向它的条目要自动掉下来
  // （与 `FileColorsModel` 按名字查作用域、查不到就跳过同效）。
  const assignments = computed(() => normalizeFileColors(projectSettings.value.fileColors, projectSettings.value.scopes ?? []))

  /** 标签页背景该涂成哪个 CSS 变量；null = 不涂（没配、没命中、或开关关着）。 */
  function tabFileColor(path: string): string | null {
    if (!tabFileColorEnabled(editorSettings.value)) return null
    const hit = resolveFileColor({
      path,
      scopes: projectSettings.value.scopes ?? [],
      fileColors: assignments.value,
      // 单隐式模块：名字取工作区目录名（与 src/scopes.ts 文件头一致，`file[名字]:` 靠它比对）。
      context: { moduleName: workspace.value?.name ?? '' },
    })
    return hit ? `var(--file-color-${hit.color.toLowerCase()})` : null
  }

  /** 标签页 tooltip 里补一句「颜色来自哪个作用域」—— 上了色却不说来源，用户无从判断。 */
  function tabFileColorScope(path: string): string | null {
    if (!tabFileColorEnabled(editorSettings.value)) return null
    return resolveFileColor({
      path,
      scopes: projectSettings.value.scopes ?? [],
      fileColors: assignments.value,
      context: { moduleName: workspace.value?.name ?? '' },
    })?.scope ?? null
  }

  return { tabFileColor, tabFileColorScope, fileColorAssignments: assignments, FILE_COLOR_NAMES }
}

export type { FileColorName }
