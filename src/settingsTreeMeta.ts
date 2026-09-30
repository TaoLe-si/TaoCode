// 设置树的元数据：页面键 / 分组 / 节点表 / 随项目保存的页 —— 从 SettingsDialog.vue 搬出的**纯数据**模块
// （2026-09-27：加 Gradle 页 + 构建工具页时 SettingsDialog.vue 顶到机检上限，顺手把"树"与"页"分开）。
//
// 与 `src/toolWindowMeta.ts` 同一个模式：一个 UI 的**表**放模块里，组件只管渲染。
// 页面键尽量直接沿用 IDEA 的 configurable id（`editor.breadcrumbs` / `Console` / `Errors` /
// `preferences.toDoOptions` / `diff.base` / `build.tools` / `reference.settingsdialog.project.gradle` …），
// 这样"这一页对应源码哪一条注册"在代码里就是答案；早期批次用过的键（appearance / editor.general /
// structure / commit …）保持不变，以免打断跳转目标与测试。
import {
  AlignLeft, Braces, Cog, FileType, Filter, FoldVertical, GitBranch, GitCommitIcon, Hammer, History, Layers,
  ListChecks, Palette, Save, SlidersHorizontal, Sparkles, Terminal,
} from 'lucide-vue-next'

/**
 * 顶层分组按 IDEA 的 `groupWeight` 排序（intellij.platform.ide.impl.xml:575-608）：
 * appearance 70 > editor 60 > project 40 > build 30 > language 20 > tools 10 > other -10。
 *
 * 「版本控制」**不是分组**，而是注册在 root 下、weight 45 的一个页面
 * （platform/vcs-impl/resources/META-INF/VcsExtensions.xml:172 `groupId="root" groupWeight="45"
 * id="project.propVCSSupport.Mappings" key="version.control.main.configurable.name"`=Version Control），
 * 所以它作为顶层页面出现（`expandOnly`）。
 */
export const SETTINGS_GROUPS = [
  // 顺序 = IDEA 的 `weight` 降序（`intellij.platform.ide.impl.xml:575-608` 的 groupConfigurable）：
  // appearance 70 > editor 60 > project 40 > build 30 > language 20 > tools 10 > other -10。
  // 本仓原先只有 4 个（缺 editor / language / other），而 `editor` 被做成了**顶层页面** ——
  // 它其实是**分组**（`id="editor" weight="60"`），页面在它下面。空分组不渲染（见 SettingsDialog）。
  { key: 'group:appearance', label: '外观与行为' },
  { key: 'group:editor', label: '编辑器' },
  { key: 'group:project', label: '默认项目' },
  { key: 'group:build', label: '构建、执行、部署' },
  { key: 'group:language', label: '语言与框架' },
  { key: 'group:tools', label: '工具' },
  { key: 'group:other', label: '其它设置' },
] as const

export type PageKey = 'preferences.lookFeel' | 'editor' | 'editor.preferences.appearance' | 'editor.preferences.tabs' | 'editor.preferences.smartKeys' | 'editor.preferences.gutterIcons' | 'editor.preferences.folding' | 'advanced'
  | 'preferences.sourceCode' | 'preferences.sourceCode.indents' | 'tools.actionsOnSave'
  | 'preferences.general' | 'editing.templates' | 'commit' | 'project.scopes'
  | 'reference.settings.ide.settings.file-colors'
  | 'editor.breadcrumbs' | 'editor.stickyLines' | 'Console' | 'Errors'
  | 'preferences.toDoOptions' | 'preferences.fileTypes' | 'preferences.externalTools'
  | 'diff.base' | 'build.tools' | 'vcs.log'
  // IDEA Gradle 页（`intellij.gradle.xml:177-179`：`groupId="build.tools" groupWeight="110"
  // id="reference.settingsdialog.project.gradle"`）—— 是 **build.tools 组的子页**，不是兄弟节点。
  | 'reference.settingsdialog.project.gradle'
  // 「版本控制」是顶层页面节点，但本仓没有目录映射内容 → expandOnly，不列进 PAGE_KEYS。
  | 'project.propVCSSupport.Mappings'

/** `expandOnly` 对应 IDEA 树里"只有子项、自己不是设置页"的父节点（点它只展开，不打开空页面）。 */
export interface SettingsNode { key: PageKey; label: string; icon: typeof Palette; parent: string | null; keywords: string; expandOnly?: boolean }

// IDEA's ConfigurableListPanel reads the groups from intellij.platform.ide.impl.xml
// groupConfigurable entries; display names come from OptionsBundle.properties
// `configurable.group.<id>.settings.display.name`. Only pages whose configurables are wired
// up render content; others do not show as empty shells.
export const SETTINGS_NODES: SettingsNode[] = [
  { key: 'preferences.lookFeel', label: '外观', icon: Palette, parent: 'group:appearance', keywords: '主题 亮色 暗色 外观 缩放 theme scale' },
  { key: 'preferences.general', label: '系统设置', icon: Cog, parent: 'group:appearance', keywords: '系统设置 退出 删除 回收站 保存 自动 同步 安全写入 打开项目 新窗口 默认目录 System Settings reopen reopenLastProject deleteToBin confirm exit safe write autosave sync process close terminate disconnect ask' },
  // IDEA 的高级设置本质是内部注册表（Registry）编辑器；TaoCode 没有注册表对话框，
  // 等价物是把内部设置（editor/general 的键）集中成一个可编辑页。
  { key: 'advanced', label: '高级设置', icon: SlidersHorizontal, parent: 'group:appearance', keywords: '高级设置 registry 注册表 内部 键值 advanced' },
  // intellij.platform.lang.impl.xml:1341-1343: appearance, groupWeight=112（Scopes=111）。
  { key: 'reference.settings.ide.settings.file-colors', label: '文件颜色', icon: Palette, parent: 'group:appearance', keywords: '文件颜色 作用域 标签页 File Colors Folder Colors Directory Colors scope tabs' },
  // 注册证据：intellij.platform.lang.impl.xml:1825 `groupId="appearance" groupWeight="111" id="project.scopes"`。
  { key: 'project.scopes', label: '作用域', icon: Filter, parent: 'group:appearance', keywords: '作用域 范围 scope scopes 文件模式 file: pattern 作用 in project 查找范围' },
  // 注册证据：`intellij.platform.lang.impl.xml:1341-1343`

  { key: 'editor', label: '常规', icon: SlidersHorizontal, parent: 'group:editor', keywords: '字体 大小 缩进 空格 制表符 行号 换行 空白 括号 标签 保存 自动 editor font indent' },
  // IDEA 的 `intellij.platform.lang.impl.xml:974-978`：`id="preferences.editor" key="title.editor"`
  // （`ApplicationBundle:240` `title.editor=General`）挂在 **`groupId="editor"` 下**，
  // 子页由 `childrenEPName="com.intellij.editorOptionsProvider"` 提供（`:1181-1184` 的
  // `editor.preferences.appearance` / `editor.preferences.smartKeys`）。
  // ⇒ **它就是一层**：`editor` 自己既是设置页（General），又直接带子页。
  // 本仓原先在中间插了一层 `editor.general`（expandOnly），是**多出来的一层嵌套** —— 已合并。
  { key: 'editor.preferences.appearance', label: '外观', icon: Palette, parent: 'editor', keywords: '外观 行号 空白 缩进参考线 括号 appearance line numbers whitespaces indent guides bracket' },
  { key: 'editor.preferences.tabs', label: '编辑器标签页', icon: Save, parent: 'editor', keywords: '标签页 上限 打开 数量 editor tabs tab limit' },
  // intellij.platform.lang.impl.xml:1181 `<editorOptionsProvider instance="...EditorSmartKeysConfigurable" id="editor.preferences.smartKeys">` ——
  // 与「编辑器标签页」同属 preferences.editor.general 的子页。
  { key: 'editor.preferences.smartKeys', label: '智能键', icon: Sparkles, parent: 'editor', keywords: '智能键 粘贴 缩进 重新格式化 smart keys paste reformat indent' },
  // intellij.platform.lang.impl.xml:1179 的 `codeFoldingOptionsProvider` + `CodeFoldingConfigurable.kt:26-27`
  // （`group.code.folding` = 「代码折叠」，id `editor.preferences.folding`）—— 五个开关里本仓只渲染
  // LSP 路径真会读的两条（Import / 自定义折叠区域），理由见 src/editorFoldingSettings.ts 的模块注释。
  { key: 'editor.preferences.folding', label: '代码折叠', icon: FoldVertical, parent: 'editor', keywords: '折叠 Import 自定义折叠区域 默认折叠 code folding collapse imports region' },
  // intellij.platform.lang.impl.xml:1187 `<editorOptionsProvider instance="...GutterIconsConfigurable" id="editor.preferences.gutterIcons">`
  { key: 'editor.preferences.gutterIcons', label: '装订线图标', icon: ListChecks, parent: 'editor', keywords: '装订线 图标 行标记 gutter icons line markers' },
  // preferences.sourceCode groupWeight=170（intellij.platform.lang.impl.xml:987）
  { key: 'preferences.sourceCode', label: '代码风格', icon: SlidersHorizontal, parent: 'group:editor', expandOnly: true, keywords: '代码风格 缩进 code style' },
  { key: 'preferences.sourceCode.indents', label: '制表符与缩进', icon: SlidersHorizontal, parent: 'preferences.sourceCode', keywords: '制表符 缩进 宽度 tab size indent use tab character' },
  // groupId="editor" groupWeight=160（:1823）
  { key: 'Errors', label: '检查', icon: SlidersHorizontal, parent: 'group:editor', keywords: '检查 错误 警告 高亮 波浪线 inspections errors diagnostics' },
  // editing.templates groupId="editor" groupWeight=130（:1000-1002）—— 实时模板属于**编辑器**，不是默认项目。
  { key: 'editing.templates', label: '实时模板', icon: Braces, parent: 'group:editor', keywords: '模板 缩写 实时 展开 template live templates' },
  // preferences.fileTypes groupId="editor" groupWeight=120（:992-994）
  { key: 'preferences.fileTypes', label: '文件类型', icon: FileType, parent: 'group:editor', keywords: '文件类型 扩展名 关联 file types extension association' },
  // parentId="preferences.editor"（:983）
  { key: 'Console', label: '控制台', icon: Terminal, parent: 'editor', keywords: '控制台 折叠 重复行 console fold lines' },
  // parentId="preferences.editor"（intellij.platform.ide.impl.xml:1231）
  { key: 'editor.breadcrumbs', label: '面包屑', icon: AlignLeft, parent: 'editor', keywords: '面包屑 路径 导航 breadcrumbs placement language' },
  // parentId="preferences.editor"（intellij.platform.ide.impl.xml:1236）
  { key: 'editor.stickyLines', label: '粘性行', icon: Layers, parent: 'editor', keywords: '粘性行 作用域 固定 sticky lines scope' },
  // preferences.toDoOptions groupId="editor"（platform/todo/resources/intellij.platform.todo.xml:49）
  { key: 'preferences.toDoOptions', label: 'TODO', icon: ListChecks, parent: 'group:editor', keywords: 'TODO 模式 标记 待办 fixme pattern marker' },

  // 顶层页面，不是分组：VcsExtensions.xml:172，root + weight 45；目录映射（project.propVCSSupport.Mappings）
  // 是它的本体，提交与 VCS 日志都是它的子页（VcsManagerConfigurable.java:83-96 逐个 add）。
  { key: 'project.propVCSSupport.Mappings', label: '版本控制', icon: GitBranch, parent: null, expandOnly: true, keywords: '版本控制 git 目录映射 忽略 问题导航 搁置 version control mappings' },
  { key: 'commit', label: '提交', icon: GitCommitIcon, parent: 'project.propVCSSupport.Mappings', keywords: '提交 信息 主题 正文 右边距 空行 换行 commit message margin' },
  { key: 'vcs.log', label: 'VCS 日志', icon: History, parent: 'project.propVCSSupport.Mappings', keywords: 'VCS 日志 标签名 仓库根名 vcs log tag root names' },

  // actions.on.save groupId="tools"（intellij.platform.ide.impl.xml:1315）
  { key: 'tools.actionsOnSave', label: '保存时操作', icon: Save, parent: 'group:tools', keywords: '保存 时 操作 格式化 重新格式化 actions on save format reformat' },
  { key: 'preferences.externalTools', label: '外部工具', icon: Hammer, parent: 'group:tools', keywords: '外部工具 命令 收藏 external tools run' },
  { key: 'diff.base', label: '差异与合并', icon: SlidersHorizontal, parent: 'group:tools', keywords: '差异 合并 上下文 行数 diff merge context lines' },

  // build.tools groupId="build"（ExternalSystemExtensions.xml:24）；它自己是一个页面
  // （ExternalSystemGroupConfigurable = BoundSearchableConfigurable，kt:22-26），同时又是 Gradle 页的父节点。
  { key: 'build.tools', label: '构建工具', icon: Hammer, parent: 'group:build', keywords: '构建 工具 自动 重新加载 build tools reload external system' },
  // Gradle（intellij.gradle.xml:177-179，groupWeight 110）：是 build.tools 组的子页。
  { key: 'reference.settingsdialog.project.gradle', label: 'Gradle', icon: Hammer, parent: 'build.tools', keywords: 'gradle 包装器 wrapper 发布 distribution 离线 offline 用户主目录 服务目录 gradle user home service directory' },
]

/** IDEA 的树里"有子项的节点"只负责展开，本身不是设置页（点它不会打开一个空页面）。 */
export function isParentOnly(key: string): boolean {
  return SETTINGS_NODES.some(node => node.key === key && node.expandOnly)
}

/** 展开状态初值：分组 + 三个总是想展开的中间节点。 */
export const EXPANDED_DEFAULT: readonly string[] = [
  ...SETTINGS_GROUPS.map(group => group.key), 'editor', 'preferences.sourceCode',
]

/**
 * 随项目保存的页（保存后才写入 `project.settings.update`）：页脚用它给出正确的保存提示，
 * 免得每加一页都要改一行嵌套三元表达式。
 */
export const PROJECT_SCOPED_PAGES: ReadonlySet<string> = new Set<PageKey>([
  'editing.templates', 'preferences.toDoOptions', 'preferences.fileTypes', 'project.scopes', 'vcs.log',
  'reference.settings.ide.settings.file-colors',
  'build.tools', 'reference.settingsdialog.project.gradle',
])

/** 真正会渲染内容的叶子页（`initialSection` 的取值域与校验都靠它）。 */
export const PAGE_KEYS: PageKey[] = ['preferences.lookFeel', 'editor', 'editor.preferences.appearance', 'editor.preferences.tabs', 'editor.preferences.smartKeys', 'editor.preferences.gutterIcons',
  'preferences.sourceCode.indents', 'tools.actionsOnSave', 'editing.templates', 'commit', 'preferences.general', 'project.scopes',
  'reference.settings.ide.settings.file-colors',
  'editor.breadcrumbs', 'editor.stickyLines', 'Console', 'Errors', 'preferences.toDoOptions', 'preferences.fileTypes',
  'preferences.externalTools', 'diff.base', 'build.tools', 'vcs.log', 'reference.settingsdialog.project.gradle']
