// Editor ▸ Color Scheme 的**纯规则层** —— 上游 IDEA 配色方案体系的对应物。
//
// 上游挂载点（本仓设置树缺的那一页，注册证据）：
//   · `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1749-1751`
//     `<applicationConfigurable groupId="editor" groupWeight="180"
//        instance="com.intellij.application.options.colors.ColorAndFontOptions"
//        id="reference.settingsdialog.IDE.editor.colors" key="title.colors.and.fonts">`
//   · 面板组合：`platform/platform-impl/src/com/intellij/application/options/colors/NewColorAndFontPanel.java:38-66`
//     （上=方案条 `SchemesPanel`、中=颜色项列表 `OptionsPanel`、下=预览 `PreviewPanel` 的垂直分栏）；
//   · 方案列表/继承：`platform/platform-impl/src/com/intellij/application/options/colors/SchemesPanel.java:86-95`
//     （reset 时重建列表并重选当前方案）、`:131-145`（切换方案后刷新颜色项表）；
//   · 方案注册中心：`platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColorsManager.java:32`
//     （getInstance）、`:44`（setGlobalScheme）、`:50`（getGlobalScheme）、`:28`（方案文件扩展名 `.icls`）。
//
// 颜色项（本页的「行」）来自上游两套属性键：
//   · 语言默认档：`platform/core-api/src/com/intellij/openapi/editor/DefaultLanguageHighlighterColors.java`
//     NUMBER=:13、KEYWORD=:14、STRING=:15、LINE_COMMENT=:17、OPERATION_SIGN=:19、BRACKETS=:25、
//     LABEL=:27、FUNCTION_DECLARATION=:33、CLASS_NAME=:37、METADATA=:59；
//   · 通用档：`platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColors.java`
//     CARET_ROW_COLOR=:18、CARET_COLOR=:19、LINE_NUMBERS_COLOR=:21、SELECTION_BACKGROUND=:34、
//     SELECTION_BACKGROUND_INACTIVE=:36、TEXT_SEARCH_RESULT_ATTRIBUTES=:62、
//     IDENTIFIER_UNDER_CARET_ATTRIBUTES=:59、GUTTER_BACKGROUND=:68；
//     默认前景/背景：`platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColorsScheme.java:32,34`。
//   · 每页可携带自己的附加键映射：`platform/platform-api/src/com/intellij/openapi/options/colors/ColorSettingsPage.java:62`
//     （`getAdditionalHighlightingTagToDescriptorMap`），演示文本 `:52`（`getDemoText`）。
//
// **本仓为什么只列这些行**：假控件禁令要求每一行都有真实存取通道。本仓的编辑器颜色全部经
// `var(--syntax-*)` / `var(--editor)` 一类的 CSS 自定义属性消费（选择器与档位规则见
// `src/editorTheme.ts` 与 `src/editorSemanticColors.ts`，两者都在运行时读 var()），所以「覆盖某个
// CSS 变量的值」就是**真实可生效**的通道。上游每行的粗体/斜体/删除线/效果线（证据
// `platform/platform-impl/src/com/intellij/application/options/colors/ColorAndFontDescriptionPanel.kt:107-108,120-121`）
// 在本仓没有对应的 var 通道（字重/斜体是 `src/editorTheme.ts` 与 `src/editorSemanticColors.ts` 里的
// 硬编码字面量，本页无权改那两个文件），所以**这些控件不画**——见 docs/batch-2026-10-06-colorscheme.md
// 「做不到」清单与接线请求 W-2。同理，彩虹括号五档（`src/editorBrackets.ts` 的硬编码 hex）也没有
// var 通道，不在列表里。
//
// 方案的「合并/继承/导出」形状逐条对齐上游序列化：
//   · 继承属性写在根节点 `parent_scheme`：`AbstractColorsScheme.java:81`（常量）、`:593`（写入）；
//   · 颜色项写入 `<attributes>`、**按键名排序**：`AbstractColorsScheme.java:84`（常量）、`:649-661`
//     （`writeAttributes`，`:655` `list.sort(Map.Entry.comparingByKey())`）；
//   · **与父方案同值的项不落盘**（等价于本仓的「等于继承值就删掉覆盖」）：`:680-687`（`writeAttribute`
//     的 equals-parent 短路）与 `:694` 起的 `optimizeAttributeMap`；
//   · 「恢复可编辑副本」的命名 = 前缀 `_@user_`：`platform/core-api/src/com/intellij/openapi/options/Scheme.java:9`
//     （`EDITABLE_COPY_PREFIX`）与 `platform/editor-ui-ex/src/com/intellij/openapi/editor/colors/impl/DefaultColorsScheme.java:104-106`
//     （`getEditableCopyName()`），剥前缀显示 = `Scheme.java:27`（`getBaseName`）；
//   · 编辑只读方案时自动建可编辑副本并选中：`ColorAndFontOptions.java:386-388`；
//   · 重置方案：`ColorSchemeActions.java:182-186` → `ColorAndFontOptions.java:392-395`；
//   · 删除方案：`ColorAndFontOptions.java:365-380`（`removeScheme`）。
//   上游的「可编辑副本被删时把子方案挂回基座」这一支我们没有照抄——本仓的重置=清空覆盖表（磁盘原样
//   的还原在上游由 EditorColorsManager 从配置文件重读，本仓没有那份配置文件，见报告「做不到」）。

/** 方案绑定的基座主题：本仓等价于上游「一份方案 = 一个亮/暗基色表」的最小版。 */
export type ColorSchemeTheme = 'light' | 'dark'

/** 分组标题（上游页面左侧树的两棵子树：General 与 Language Defaults）。 */
export type ColorAttributeGroup = 'general' | 'language'

export interface ColorAttributeItem {
  /** 本仓稳定 id（存储键用 **externalKey**，与上游 option name 同形）。 */
  readonly id: string
  /** 上游属性键的外部名（`TextAttributesKey.externalName` / `ColorKey` 名）。 */
  readonly externalKey: string
  /** 界面标签（本仓界面为中文；上游 bundle 不在本地树 ⇒ 用直译，规约 §3）。 */
  readonly label: string
  readonly hint: string
  /** 被覆盖的 CSS 自定义属性（值形如 `--syntax-keyword`）。 */
  readonly cssVar: string
  readonly group: ColorAttributeGroup
  /** 上游依据（相对路径:行号），渲染层不消费，供判据测试与文档钉住。 */
  readonly upstream: string
  /** 本仓消费方（真实生效证据），供判据测试与文档钉住。 */
  readonly consumer: string
}

// 每一项都必须有 var() 消费方（文件头说明；tests/color-scheme-rules.test.mjs 反向钉住这条纪律）。
export const COLOR_ATTRIBUTE_ITEMS: readonly ColorAttributeItem[] = [
  // —— General（上游 `EditorColors.java` / `EditorColorsScheme.java` 的 ColorKey 档）——
  {
    id: 'editorBackground', externalKey: 'BACKGROUND', label: '默认背景', hint: '编辑器文本区底色。',
    cssVar: '--editor', group: 'general',
    upstream: 'platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColorsScheme.java:32',
    consumer: 'src/editorTheme.ts:33',
  },
  {
    id: 'editorForeground', externalKey: 'FOREGROUND', label: '默认文本前景', hint: '未被着色 token 覆盖的文字色。',
    cssVar: '--text', group: 'general',
    upstream: 'platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColorsScheme.java:34',
    consumer: 'src/editorTheme.ts:33',
  },
  {
    id: 'caretRow', externalKey: 'CARET_ROW_COLOR', label: '光标行', hint: '插入符所在行的行底色。',
    cssVar: '--active-line', group: 'general',
    upstream: 'platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColors.java:18',
    consumer: 'src/editorTheme.ts:38-40',
  },
  {
    id: 'caret', externalKey: 'CARET_COLOR', label: '插入符', hint: '光标竖线。',
    cssVar: '--bright', group: 'general',
    upstream: 'platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColors.java:19',
    consumer: 'src/editorTheme.ts:35,63',
  },
  {
    id: 'gutterBackground', externalKey: 'GUTTER_BACKGROUND', label: '装订线背景', hint: '行号槽底色。',
    cssVar: '--gutter', group: 'general',
    upstream: 'platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColors.java:68',
    consumer: 'src/editorTheme.ts:37',
  },
  {
    id: 'lineNumbers', externalKey: 'LINE_NUMBERS_COLOR', label: '行号', hint: '装订线上的行号字色。',
    cssVar: '--muted', group: 'general',
    upstream: 'platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColors.java:21',
    consumer: 'src/editorTheme.ts:37',
  },
  {
    id: 'selectionBackground', externalKey: 'SELECTION_BACKGROUND', label: '选区背景', hint: '编辑器获得焦点时的选区底色。',
    cssVar: '--selection', group: 'general',
    upstream: 'platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColors.java:34',
    consumer: 'src/editorTheme.ts:61',
  },
  {
    id: 'selectionInactive', externalKey: 'SELECTION_BACKGROUND_INACTIVE', label: '非激活选区背景', hint: '编辑器失焦时的选区底色。',
    cssVar: '--selection-inactive', group: 'general',
    upstream: 'platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColors.java:36',
    consumer: 'src/editorTheme.ts:60',
  },
  {
    id: 'searchResult', externalKey: 'TEXT_SEARCH_RESULT_ATTRIBUTES', label: '查找命中', hint: '文件内查找的命中底色。',
    cssVar: '--search-match', group: 'general',
    upstream: 'platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColors.java:62',
    consumer: 'src/editorTheme.ts:67',
  },
  {
    id: 'identifierUnderCaret', externalKey: 'IDENTIFIER_UNDER_CARET_ATTRIBUTES', label: '同符号高亮', hint: 'LSP 文档高亮/用法高亮的底色。',
    cssVar: '--symbol-highlight', group: 'general',
    upstream: 'platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColors.java:59',
    consumer: 'src/editorTheme.ts:51,54',
  },
  // —— Language Defaults（上游 `DefaultLanguageHighlighterColors` 的档）——
  {
    id: 'keyword', externalKey: 'DEFAULT_KEYWORD', label: '关键字', hint: '控制流与声明关键字（词法+语义两层共用）。',
    cssVar: '--syntax-keyword', group: 'language',
    upstream: 'platform/core-api/src/com/intellij/openapi/editor/DefaultLanguageHighlighterColors.java:14',
    consumer: 'src/editorTheme.ts:17；src/editorSemanticColors.ts:26',
  },
  {
    id: 'string', externalKey: 'DEFAULT_STRING', label: '字符串', hint: '字符串与正则字面量。',
    cssVar: '--syntax-string', group: 'language',
    upstream: 'platform/core-api/src/com/intellij/openapi/editor/DefaultLanguageHighlighterColors.java:15',
    consumer: 'src/editorTheme.ts:18；src/editorSemanticColors.ts:28-29',
  },
  {
    id: 'number', externalKey: 'DEFAULT_NUMBER', label: '数字', hint: '数值、布尔与 null 字面量。',
    cssVar: '--syntax-number', group: 'language',
    upstream: 'platform/core-api/src/com/intellij/openapi/editor/DefaultLanguageHighlighterColors.java:13',
    consumer: 'src/editorTheme.ts:20；src/editorSemanticColors.ts:30',
  },
  {
    id: 'lineComment', externalKey: 'DEFAULT_LINE_COMMENT', label: '注释', hint: '词法注释（上游行注释/块注释两档在本仓共用一个变量）。',
    cssVar: '--syntax-comment', group: 'language',
    upstream: 'platform/core-api/src/com/intellij/openapi/editor/DefaultLanguageHighlighterColors.java:17',
    consumer: 'src/editorTheme.ts:19；src/editorSemanticColors.ts:31',
  },
  {
    id: 'operationSign', externalKey: 'DEFAULT_OPERATION_SIGN', label: '操作符', hint: '运算符与标点（上游 BRACKETS 档在本仓与操作符同色）。',
    cssVar: '--syntax-operator', group: 'language',
    upstream: 'platform/core-api/src/com/intellij/openapi/editor/DefaultLanguageHighlighterColors.java:19,25',
    consumer: 'src/editorTheme.ts:24；src/editorSemanticColors.ts:47',
  },
  {
    id: 'className', externalKey: 'DEFAULT_CLASS_NAME', label: '类/类型名', hint: '类、接口、命名空间。',
    cssVar: '--syntax-type', group: 'language',
    upstream: 'platform/core-api/src/com/intellij/openapi/editor/DefaultLanguageHighlighterColors.java:37',
    consumer: 'src/editorTheme.ts:21；src/editorSemanticColors.ts:34-41',
  },
  {
    id: 'functionDeclaration', externalKey: 'DEFAULT_FUNCTION_DECLARATION', label: '函数声明', hint: '函数与方法名。',
    cssVar: '--syntax-function', group: 'language',
    upstream: 'platform/core-api/src/com/intellij/openapi/editor/DefaultLanguageHighlighterColors.java:33',
    consumer: 'src/editorTheme.ts:22；src/editorSemanticColors.ts:32-33',
  },
  {
    id: 'label', externalKey: 'DEFAULT_LABEL', label: '属性/标签', hint: '属性名与标签名（本仓 propertyName/attributeName/labelName 共用一档）。',
    cssVar: '--syntax-property', group: 'language',
    upstream: 'platform/core-api/src/com/intellij/openapi/editor/DefaultLanguageHighlighterColors.java:27',
    consumer: 'src/editorTheme.ts:23；src/editorSemanticColors.ts:43-45',
  },
  {
    id: 'metadata', externalKey: 'DEFAULT_METADATA', label: '元数据', hint: '注解与预处理指令。',
    cssVar: '--syntax-meta', group: 'language',
    upstream: 'platform/core-api/src/com/intellij/openapi/editor/DefaultLanguageHighlighterColors.java:59',
    consumer: 'src/editorTheme.ts:25；src/editorSemanticColors.ts:42',
  },
] as const

/** externalKey → 项（存储与导出都用 externalKey，与上游 option name 同形）。 */
export const COLOR_ATTRIBUTE_BY_KEY: Readonly<Record<string, ColorAttributeItem>> = Object.freeze(
  Object.fromEntries(COLOR_ATTRIBUTE_ITEMS.map(item => [item.externalKey, item])),
)

// ── 方案模型 ───────────────────────────────────────────────────────────────

export interface ColorScheme {
  /** 存储名。可编辑副本带 `_@user_` 前缀（`Scheme.java:9`），列表显示时剥掉（`Scheme.java:27`）。 */
  readonly name: string
  /** 继承的方案名（null = 基座）。上游 `parent_scheme`：`AbstractColorsScheme.java:81,593`。 */
  readonly inheritFrom: string | null
  /** 基座主题。上游「一份 .icls = 一套完整色表」在本仓退化为「基座主题 + 覆盖表」。 */
  readonly theme: ColorSchemeTheme
  /** 只读基座（上游 `DefaultColorsScheme.isReadOnly`，编辑时自动派生可编辑副本）。 */
  readonly readOnly: boolean
  /** 覆盖表：externalKey → 前景色（`#rrggbb`，来自取色器；等于继承值即删除，见 `setAttributeOverride`）。 */
  readonly overrides: Readonly<Record<string, string>>
}

/** 上游 `EDITABLE_COPY_PREFIX`（`platform/core-api/src/com/intellij/openapi/options/Scheme.java:9`）。 */
export const EDITABLE_COPY_PREFIX = '_@user_'

/** 可编辑副本的存储名（`DefaultColorsScheme.java:104-106`：前缀 + 基座名）。 */
export function editableCopyName(baseName: string): string {
  return EDITABLE_COPY_PREFIX + baseName
}

/** 列表显示名：剥掉可编辑副本前缀（`Scheme.java:24-27` 的 `getBaseName`）。 */
export function schemeDisplayName(name: string): string {
  return name.startsWith(EDITABLE_COPY_PREFIX) ? name.slice(EDITABLE_COPY_PREFIX.length) : name
}

/**
 * 继承链：从**基座到自己**（`[base, …, self]`）。未注册的名字返回空链。
 * 防御循环继承：访问集合命中即断链（本仓自定的健壮性规则，上游靠启动期校验）。
 */
export function schemeChain(schemes: readonly ColorScheme[], name: string): ColorScheme[] {
  const byName = new Map(schemes.map(s => [s.name, s]))
  const chain: ColorScheme[] = []
  const seen = new Set<string>()
  let current = byName.get(name)
  while (current && !seen.has(current.name)) {
    seen.add(current.name)
    chain.unshift(current)
    current = current.inheritFrom ? byName.get(current.inheritFrom) : undefined
  }
  return chain
}

/** 方案所属基座主题（沿链到根）。 */
export function schemeThemeOf(schemes: readonly ColorScheme[], name: string): ColorSchemeTheme | null {
  const chain = schemeChain(schemes, name)
  return chain.length ? chain[0].theme : null
}

/**
 * 合并继承：链上每一层的覆盖表**后者胜**（上游 `AbstractColorsScheme.getAttributes` 的委托链，
 * 解析序见 `:710`——先看直接定义、再退到父方案）。
 */
export function resolveOverrides(schemes: readonly ColorScheme[], name: string): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const scheme of schemeChain(schemes, name)) Object.assign(merged, scheme.overrides)
  return merged
}

/**
 * 「写入即 diff」：值等于继承值就**不落这条覆盖**（上游 `writeAttribute:680-687` 的 equals-parent
 * 短路 + `optimizeAttributeMap`）。返回新数组，不改入参。
 */
export function setAttributeOverride(
  schemes: readonly ColorScheme[], name: string, externalKey: string, value: string,
): ColorScheme[] {
  const parentMerged = parentOverridesOf(schemes, name)
  const next = new Map(schemes.map(s => [s.name, s]))
  const target = next.get(name)
  if (!target || target.readOnly) return [...schemes]
  const overrides = { ...target.overrides }
  if (parentMerged[externalKey] === value) delete overrides[externalKey]
  else overrides[externalKey] = value
  next.set(name, { ...target, overrides })
  return [...next.values()]
}

/** 该项的「继承自父方案」生效值（不含自己的覆盖）。 */
export function parentOverridesOf(schemes: readonly ColorScheme[], name: string): Record<string, string> {
  const target = schemes.find(s => s.name === name)
  if (!target || !target.inheritFrom) return {}
  return resolveOverrides(schemes, target.inheritFrom)
}

/** 单项还原（上游行内 Revert 钮，`ColorAndFontDescriptionPanel.kt:83-86`）：删掉这一条覆盖。 */
export function revertAttributeOverride(schemes: readonly ColorScheme[], name: string, externalKey: string): ColorScheme[] {
  const target = schemes.find(s => s.name === name)
  if (!target || target.readOnly || !(externalKey in target.overrides)) return [...schemes]
  const overrides = { ...target.overrides }
  delete overrides[externalKey]
  return schemes.map(s => (s.name === name ? { ...s, overrides } : s))
}

/** 整方案重置（`ColorSchemeActions.java:182-186` → `ColorAndFontOptions.java:392-395`）：清空覆盖表。 */
export function resetSchemeOverrides(schemes: readonly ColorScheme[], name: string): ColorScheme[] {
  const target = schemes.find(s => s.name === name)
  if (!target || target.readOnly) return [...schemes]
  return schemes.map(s => (s.name === name ? { ...s, overrides: {} } : s))
}

/**
 * 编辑只读基座前先派生可编辑副本并选中（`ColorAndFontOptions.java:386-388`：
 * `selectScheme(defaultScheme.getEditableCopyName())` —— 副本存在即复用，不重复建）。
 * 副本继承基座、名字 = `_@user_基座名`；名字被别的方案占了才追加计数（本仓自定的冲突规则）。
 */
export function ensureEditableScheme(
  schemes: readonly ColorScheme[], name: string,
): { schemes: ColorScheme[]; name: string } {
  const target = schemes.find(s => s.name === name)
  if (!target || !target.readOnly) return { schemes: [...schemes], name }
  const existingCopy = schemes.find(s => s.name === editableCopyName(target.name))
  if (existingCopy && !existingCopy.readOnly) return { schemes: [...schemes], name: existingCopy.name }
  let copyName = editableCopyName(target.name)
  const taken = new Set(schemes.map(s => s.name))
  for (let n = 2; taken.has(copyName); n++) copyName = editableCopyName(`${target.name} ${n}`)
  const copy: ColorScheme = { name: copyName, inheritFrom: target.name, theme: target.theme, readOnly: false, overrides: {} }
  return { schemes: [...schemes, copy], name: copyName }
}

/** 复制方案（同一命名规则；源名字已带前缀时先剥再拼，避免双前缀）。 */
export function duplicateScheme(schemes: readonly ColorScheme[], name: string): { schemes: ColorScheme[]; name: string } | null {
  const target = schemes.find(s => s.name === name)
  if (!target) return null
  const baseName = schemeDisplayName(target.name)
  let copyName = editableCopyName(baseName)
  const taken = new Set(schemes.map(s => s.name))
  for (let n = 2; taken.has(copyName); n++) copyName = editableCopyName(`${baseName} ${n}`)
  const copy: ColorScheme = {
    name: copyName, inheritFrom: target.inheritFrom, theme: target.theme, readOnly: false, overrides: { ...target.overrides },
  }
  return { schemes: [...schemes, copy], name: copyName }
}

/**
 * 删除方案（仅可编辑副本可删；上游 `ColorAndFontOptions.java:365-380`）。
 * 被删方案的**直接子方案**挂到被删者的父方案上（本仓自定规则：保持链不断；上游由 manager 层重挂，
 * 具体行号未核对 ⇒ 不引用）。
 */
export function removeScheme(schemes: readonly ColorScheme[], name: string): ColorScheme[] {
  const target = schemes.find(s => s.name === name)
  if (!target || target.readOnly) return [...schemes]
  return schemes
    .filter(s => s.name !== name)
    .map(s => (s.inheritFrom === name ? { ...s, inheritFrom: target.inheritFrom } : s))
}

/** 名字合法性：非空、不与现有方案重名（重名会串存储键；本仓自定，上游弹 ConfigurationException 未逐行核）。 */
export function isValidSchemeName(name: string, schemes: readonly ColorScheme[]): boolean {
  const trimmed = name.trim()
  return !!trimmed && !schemes.some(s => s.name === trimmed || s.name === editableCopyName(trimmed))
}

// ── 搜索（上游：颜色项树上装速度搜索 `ColorOptionsTree.java:58` `TreeSpeedSearch.installOn`）──

/** 大小写不敏感的子串匹配：标签、外部键、CSS 变量名都算命中面。 */
export function attributeMatchesSearch(item: ColorAttributeItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return item.label.toLowerCase().includes(q)
    || item.externalKey.toLowerCase().includes(q)
    || item.cssVar.toLowerCase().includes(q)
}

/** 过滤出可渲染的分组列表（保持上游「General 在前、Language Defaults 在后」的两棵树次序）。 */
export function filterColorAttributeItems(
  items: readonly ColorAttributeItem[], query: string,
): { group: ColorAttributeGroup; entries: ColorAttributeItem[] }[] {
  const hit = items.filter(item => attributeMatchesSearch(item, query))
  const groups: { group: ColorAttributeGroup; entries: ColorAttributeItem[] }[] = []
  for (const group of ['general', 'language'] as const) {
    const entries = hit.filter(item => item.group === group)
    if (entries.length) groups.push({ group, entries })
  }
  return groups
}

// ── 导出形状（上游 `.icls` 骨架；证据 `AbstractColorsScheme.java:572-593,649-691`）──

/** 上游 `VERSION_ATTR = "version"`（`AbstractColorsScheme.java:78`）；本仓写固定 1。 */
export const SCHEME_XML_VERSION = '1'

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * 方案 → `.icls` 风格的 XML 文本。骨架逐条对应上游 `writeExternal`：
 *   · 根节点 `scheme` 的三个属性 `name` / `version` / `parent_scheme`：`:572-573,591-593`
 *     （`NAME_ATTR` 常量 `:71`、`VERSION_ATTR` `:78`、`PARENT_SCHEME_ATTR` `:81`）；
 *   · `attributes` 子节点、项**按 externalKey 排序**：`:649-661`（`:655` 排序）；
 *   · 每项 `option name=外部键` + `value` 子节点：`:689-691`（`OPTION_ELEMENT`/`VALUE_ELEMENT` `:82,85`）。
 * `value` 里的子键本仓写 `FOREGROUND`：上游该子键由 `TextAttributes.writeExternal`
 * （`platform/core-api/src/com/intellij/openapi/editor/markup/TextAttributes.java:255`）经属性飞权重写器
 * 生成，飞重本体不在本地参考树 ⇒ 子键字符串**无法核实**，本仓按可核实的 `FOREGROUND` 色值语义写死，
 * 并在判据测试里钉住形状（见报告）。色值写**六位小写十六进制、不带 #**（本仓自定序列化，测试钉住）。
 */
export function schemeToXml(scheme: ColorScheme): string {
  const lines: string[] = []
  const parent = scheme.inheritFrom ? ` parent_scheme="${escapeXml(scheme.inheritFrom)}"` : ''
  lines.push(`<scheme name="${escapeXml(scheme.name)}" version="${SCHEME_XML_VERSION}"${parent}>`)
  const keys = Object.keys(scheme.overrides).sort()
  if (keys.length) {
    lines.push('  <attributes>')
    for (const key of keys) {
      const color = scheme.overrides[key].replace('#', '').toLowerCase()
      lines.push(`    <option name="${escapeXml(key)}">`)
      lines.push('      <value>')
      lines.push(`        <option name="FOREGROUND" value="${color}" />`)
      lines.push('      </value>')
      lines.push('    </option>')
    }
    lines.push('  </attributes>')
  }
  lines.push('</scheme>')
  return lines.join('\n')
}
