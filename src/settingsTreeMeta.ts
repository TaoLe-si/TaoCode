// 设置树的元数据：页面键 / 分组 / 节点表 / 随项目保存的页 —— 从 SettingsDialog.vue 搬出的**纯数据**模块
// （2026-09-27：加 Gradle 页 + 构建工具页时 SettingsDialog.vue 顶到机检上限，顺手把"树"与"页"分开）。
//
// 与 `src/toolWindowMeta.ts` 同一个模式：一个 UI 的**表**放模块里，组件只管渲染。
// 页面键尽量直接沿用 IDEA 的 configurable id（`editor.breadcrumbs` / `Console` / `Errors` /
// `preferences.toDoOptions` / `diff.base` / `build.tools` / `reference.settingsdialog.project.gradle` …），
// 这样"这一页对应源码哪一条注册"在代码里就是答案；早期批次用过的键（appearance / editor.general /
// structure / commit …）保持不变，以免打断跳转目标与测试。
import {
  AlignLeft, Bot, Braces, Bug, CalendarClock, Cog, Eye, FileSearch, FileType, Filter, FoldVertical, GitBranch, GitCommitIcon, Hammer, History, Keyboard,
  Layers, ListChecks, Palette, Save, ShieldCheck, SlidersHorizontal, Sparkles, Terminal, Type, Volume2,
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
  | 'preferences.general' | 'ide.date.format' | 'editing.templates' | 'commit' | 'project.scopes' | 'project.workspaceFileSearch'
  | 'reference.settings.ide.settings.file-colors'
  // `trusted.hosts` 注册在 groupId="appearance"（intellij.platform.ide.impl.xml:783-786，
  // instance TrustedHostsConfigurable，key configurable.trusted.hosts.display.name）。
  | 'trusted.hosts'
  // AudioCuesConfigurable（`intellij.platform.ide.impl.xml:971-976`）：
  // `groupId="appearance" groupWeight="140" id="ide.audiocues"` —— 自己的页，不是 general 的子页。
  | 'ide.audiocues'
  | 'editor.breadcrumbs' | 'editor.stickyLines' | 'Console' | 'Errors'
  // ColorAndFontOptions（`intellij.platform.ide.impl.xml:1749-1752`：`groupId="editor" groupWeight="180" dynamic="true"`）。
  | 'reference.settingsdialog.IDE.editor.colors'
  // InlaySettingsConfigurable（intellij.platform.lang.impl.xml:935-941 `parentId="editor" id="inlay.hints"`）。
  | 'inlay.hints'
  // Code Vision 页（上游把这一组挂在 Inlay Hints 页里，本仓单列一页；键名是本仓的）。
  | 'code.vision'
  | 'preferences.toDoOptions' | 'preferences.fileTypes' | 'preferences.externalTools'
  | 'diff.base' | 'build.tools' | 'vcs.log' | 'debugger'
  // Keymap 顶层页（`intellij.platform.ide.impl.xml:951` 的 `id="preferences.keymap"`）——
  // 键位面板 `KeymapPanel`（`KeymapPanel.java:111`）本体，可搜索可改键。
  | 'preferences.keymap'
  // IDEA Gradle 页（`intellij.gradle.xml:177-179`：`groupId="build.tools" groupWeight="110"
  // id="reference.settingsdialog.project.gradle"`）—— 是 **build.tools 组的子页**，不是兄弟节点。
  | 'reference.settingsdialog.project.gradle'
  // 「版本控制」是顶层页面节点，但本仓没有目录映射内容 → expandOnly，不列进 PAGE_KEYS。
  | 'project.propVCSSupport.Mappings'
  // Agent 设置（本仓自己的页，上游 IDEA 没有对应物）：Agent 对话窗口的模型/权限/差异策略。
  // 用户要求（2026-10-07）「Agent 设置单开一栏」—— 顶层页，不挂在任何组下。
  | 'agent'

/** `expandOnly` 对应 IDEA 树里"只有子项、自己不是设置页"的父节点（点它只展开，不打开空页面）。 */
export interface SettingsNode { key: PageKey; label: string; icon: typeof Palette; parent: string | null; keywords: string; expandOnly?: boolean }

// IDEA's ConfigurableListPanel reads the groups from intellij.platform.ide.impl.xml
// groupConfigurable entries; display names come from OptionsBundle.properties
// `configurable.group.<id>.settings.display.name`. Only pages whose configurables are wired
// up render content; others do not show as empty shells.
export const SETTINGS_NODES: SettingsNode[] = [
  { key: 'preferences.lookFeel', label: '外观', icon: Palette, parent: 'group:appearance', keywords: '主题 亮色 暗色 外观 缩放 theme scale' },
  { key: 'preferences.general', label: '系统设置', icon: Cog, parent: 'group:appearance', keywords: '系统设置 退出 删除 回收站 保存 自动 同步 安全写入 打开项目 新窗口 默认目录 System Settings reopen reopenLastProject deleteToBin confirm exit safe write autosave sync process close terminate disconnect ask' },
  // DateTimeFormatConfigurable (PlatformExtensions.xml, parentId="preferences.general", id="ide.date.format").
  { key: 'ide.date.format', label: '日期格式', icon: CalendarClock, parent: 'preferences.general', keywords: '日期 格式 日期时间 日期格式 覆盖系统格式 24 小时制 美化 pretty date time format pattern system 24 hour' },
  // trusted.hosts groupId="appearance"（intellij.platform.ide.impl.xml:783-786）：一张受信任位置清单
  // （TrustedHostsConfigurable），新增/删除后信任判定即时生效。
  { key: 'trusted.hosts', label: '受信任位置', icon: ShieldCheck, parent: 'group:appearance', keywords: '受信任 位置 信任 项目 安全模式 不受信任 清单 trusted locations trust safe mode' },
  // AudioCuesConfigurable（intellij.platform.ide.impl.xml:971-976）：
  // `groupId="appearance" groupWeight="140" id="ide.audiocues"` —— 播放档（auto/on/off）+ 六个 cue 的逐条开关。
  { key: 'ide.audiocues', label: '音频提示', icon: Volume2, parent: 'group:appearance', keywords: '音频 提示 声音 无障碍 朗读 播报 audio cues accessibility sound' },
  // IDEA 的高级设置本质是内部注册表（Registry）编辑器；TaoCode 没有注册表对话框，
  // 等价物是把内部设置（editor/general 的键）集中成一个可编辑页。
  { key: 'advanced', label: '高级设置', icon: SlidersHorizontal, parent: 'group:appearance', keywords: '高级设置 registry 注册表 内部 键值 advanced' },
  // intellij.platform.lang.impl.xml:1341-1343: appearance, groupWeight=112（Scopes=111）。
  { key: 'reference.settings.ide.settings.file-colors', label: '文件颜色', icon: Palette, parent: 'group:appearance', keywords: '文件颜色 作用域 标签页 File Colors Folder Colors Directory Colors scope tabs' },
  // 注册证据：intellij.platform.lang.impl.xml:1825 `groupId="appearance" groupWeight="111" id="project.scopes"`。
  { key: 'project.scopes', label: '作用域', icon: Filter, parent: 'group:appearance', keywords: '作用域 范围 scope scopes 文件模式 file: pattern 作用 in project 查找范围' },
  { key: 'project.workspaceFileSearch', label: '工作区搜索范围', icon: FileSearch, parent: 'group:project', keywords: '工作区 搜索 范围 忽略规则 zcodeignore gitignore workspace search scope ignore files' },
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
  { key: 'editing.templates', label: '实时模板', icon: Braces, parent: 'group:editor', keywords: '模板 缩写 实时 展开 文件模板 file template parse 变量 template live templates' },
  // preferences.fileTypes groupId="editor" groupWeight=120（:992-994）
  { key: 'preferences.fileTypes', label: '文件类型', icon: FileType, parent: 'group:editor', keywords: '文件类型 扩展名 关联 file types extension association' },
  // parentId="preferences.editor"（:983）
  { key: 'Console', label: '控制台', icon: Terminal, parent: 'editor', keywords: '控制台 折叠 重复行 console fold lines' },
  // 配色方案（`intellij.platform.ide.impl.xml:1749-1752`：**groupId**="editor" groupWeight="180" ——
  // 分组直属（与「常规」/「检查」同层），不是 editor 页的子页；标题 `ApplicationBundle.properties:524`）。
  { key: 'reference.settingsdialog.IDE.editor.colors', label: '配色方案', icon: Palette, parent: 'group:editor', keywords: '配色 方案 颜色 语法高亮 darcula light color scheme colors and fonts' },
  // parentId="preferences.editor"（intellij.platform.ide.impl.xml:1231）
  { key: 'editor.breadcrumbs', label: '面包屑', icon: AlignLeft, parent: 'editor', keywords: '面包屑 路径 导航 breadcrumbs placement language' },
  // parentId="preferences.editor"（intellij.platform.ide.impl.xml:1236）
  { key: 'editor.stickyLines', label: '粘性行', icon: Layers, parent: 'editor', keywords: '粘性行 作用域 固定 sticky lines scope' },
  // parentId="editor"（intellij.platform.lang.impl.xml:935-941，`id="inlay.hints" groupWeight="1"`）：
  // LSP inlayHint 按 kind 分的三档（类型 / 参数名 / 其它）。
  { key: 'inlay.hints', label: '内联提示', icon: Type, parent: 'editor', keywords: '内联 提示 参数名 类型 推断 inlay hints parameter type' },
  // Code Vision：上游页名与总闸文案在 `CodeVisionBundle.properties:2-3`（"Code Vision" / "Enable Code Vision"），
  // 分组名 `settings.hints.new.group.code.vision`（`ApplicationBundle.properties:725-726`）—— 上游把它当
  // Inlay Hints 页里的一个**分组**，本仓设置树按页组织 ⇒ 单列一页。键名 `code.vision` 是**本仓起的**
  // （上游那个 configurable 的注册行不在本地树里，不编一个假的 id）。
  { key: 'code.vision', label: 'Code Vision', icon: Eye, parent: 'editor', keywords: 'code vision 行上方 提示 嵌入 引用数 问题计数 lens codeLens 可见条数' },
  // preferences.toDoOptions groupId="editor"（platform/todo/resources/intellij.platform.todo.xml:49）
  { key: 'preferences.toDoOptions', label: 'TODO', icon: ListChecks, parent: 'group:editor', keywords: 'TODO 模式 标记 待办 fixme pattern marker' },

  // 顶层页面，不是分组：VcsExtensions.xml:172，root + weight 45；目录映射（project.propVCSSupport.Mappings）
  // 是它的本体，提交与 VCS 日志都是它的子页（VcsManagerConfigurable.java:83-96 逐个 add）。
  { key: 'project.propVCSSupport.Mappings', label: '版本控制', icon: GitBranch, parent: null, expandOnly: true, keywords: '版本控制 git 目录映射 忽略 问题导航 搁置 version control mappings' },
  // Keymap：`intellij.platform.ide.impl.xml:950-952`
  // `<applicationConfigurable groupId="root" groupWeight="65" instance="...ui.KeymapPanel" id="preferences.keymap" key="keymap.display.name" bundle="messages.KeyMapBundle"/>`
  // （`keymap.display.name=Keymap` 见 `platform/platform-api/resources/messages/KeyMapBundle.properties:26`）。
  // `groupId="root"` ⇒ **顶层页面节点**，权重 65 > 版本控制的 45，所以排在版本控制之前。
  // 面板本体是 `KeymapPanel`（`KeymapPanel.java:111` `implements SearchableConfigurable`）——
  // 上一批只把入口放在帮助菜单（`src/menus/helpMenu.ts:52`），那是**本仓的落位决定**不是上游位置；
  // 这一页才是上游的真实入口，与对话框共用同一份 `keymapHost` 活状态。
  { key: 'preferences.keymap', label: '键盘映射', icon: Keyboard, parent: null, keywords: '键位 快捷键 改键 冲突 恢复默认 keymap shortcuts change conflicts' },
  // Agent 设置（本仓自己的页，上游没有对应物）：模型/权限四档/上下文预算/差异接受策略。
  // 规则、默认值与持久化都在 src/agentSettings.ts；页面是 src/components/AgentSettingsPage.vue。
  { key: 'agent', label: 'Agent', icon: Bot, parent: null, keywords: 'Agent 对话 模型 权限 批准 上下文 差异 保留 撤回 agent model permission approval diff do undo' },
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
  // 调试器的数据视图（XDebuggerDataViewSettings：xdebugger-impl/.../settings/，
  // `XDebuggerSettingsConfigurable` 挂在 Build, Execution, Deployment 分组下）：
  // 隐藏 null 值 + 命名变量按名排序，消费点在 DebugPanel 的变量树。
  { key: 'debugger', label: '调试器', icon: Bug, parent: 'group:build', keywords: '调试器 变量 数据视图 隐藏 null 排序 debugger variables data view hide null sort' },
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
  'build.tools', 'reference.settingsdialog.project.gradle', 'tools.actionsOnSave', 'project.workspaceFileSearch',
])

/** 真正会渲染内容的叶子页（`initialSection` 的取值域与校验都靠它）。 */
export const PAGE_KEYS: PageKey[] = ['preferences.lookFeel', 'editor', 'editor.preferences.appearance', 'editor.preferences.tabs', 'editor.preferences.smartKeys', 'editor.preferences.gutterIcons',
  'preferences.sourceCode.indents', 'tools.actionsOnSave', 'editing.templates', 'commit', 'preferences.general', 'ide.date.format', 'project.scopes', 'project.workspaceFileSearch',
  'reference.settings.ide.settings.file-colors',
  'trusted.hosts',
  'ide.audiocues', 'inlay.hints', 'code.vision',
  'reference.settingsdialog.IDE.editor.colors',
  'editor.breadcrumbs', 'editor.stickyLines', 'Console', 'Errors', 'preferences.toDoOptions', 'preferences.fileTypes',
  'preferences.externalTools', 'diff.base', 'build.tools', 'vcs.log', 'reference.settingsdialog.project.gradle',
  'preferences.keymap', 'agent']
