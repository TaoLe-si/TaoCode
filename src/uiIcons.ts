// 图标度量的**单一真源**（几何层，对标上游常量；配色不归这里管）。
//
// 背景：仓库里曾有 327 处 `:size="N"` 硬编码，横跨 16 个不同的数字，同一个 `X`（关闭）
// 用了 8 种（10/11/12/13/14/15/16/18）。而 `src/style.css:226` 又用 CSS `width` 覆盖了
// 一批顶栏图标的 SVG `width` 属性 —— 于是模板里写着 `:size="14"`，实际渲染 20px，源码
// 在骗人。本模块把"某个位置该用多大"变成**有名字的角色**，数字只在这里出现一次。
//
// 分工沿用 `tokens.css` 的三层约定：**配色是我们的，几何是源码的。** 下面每一个像素值
// 都能在上游源码里找到出处，找不到的就不写。
//
// 三条硬规则（`tests/ui-icons.test.mjs` 会逐条守）：
//   1. 尺寸只从这里取，不在模板里写 `:size="14"`；
//   2. 不许用 Unicode 字形（`✓ ✗ ▾ ▸ ×`）冒充图标 —— 一律用 lucide 组件，
//      否则同一个 14px 槽位里会同时出现 13px 描边图标和 12px 字体符号；
//   3. 纯图标按钮必须同时给 `title`（鼠标悬停提示）与 `aria-label`（屏幕阅读器名）。

/**
 * 一个尺寸角色。`cssVar` 是 `tokens.css` 里对应的自定义属性 —— 组件写模板时用
 * `:size="iconSize.menu"` 这种调用，样式里写 `var(--icon-size-md)`，两处共用同一个数。
 */
export type IconRole = keyof typeof ICON_SIZE

/**
 * 尺寸阶梯 —— 全仓图标尺寸**只在这里出现**。
 *
 * 每一档的出处分两类，`ICON_SIZE_PROVENANCE` 里逐条登记：
 *   · `upstream`  —— 上游源码里有对应常量，本文注 `file:line`；`git grep` 不到出处的数字
 *     不许标成这一类。
 *   · `local`     —— 上游没有这个常量（行内次级记号、空状态插画），是我们自己的设计决定。
 *     允许，但必须在同一张表里显式声明 —— 免得半年后有人以为它是抄来的常量而不敢动。
 *
 * 为什么不把 11/24/28 也去上游找：上游的图标常量只覆盖**控件内**的图标（7/13/14/15/16/20/
 * 32/40，见 `git grep "iconSize = \|ICON_SIZE = "`），行内记号和空状态插画在上游根本不是
 * 同一套度量，硬凑一个"像的"行号比不写更糟。
 */
export const ICON_SIZE = {
  /** 徽标/芯片里的极小记号（移除 x、角标点）。local。 */
  chip: 10,
  /** 行内的次级记号：标签页下拉箭头、树节点前导图标、状态栏记号、面包屑旁的图标。
   *  local —— 挨着 11px 行高放不下 12 以上，再小认不出形状。 */
  inline: 11,
  /** 密排列表（变量树、文件树）的折叠箭头。local，与 `inline` 同一族的上一档。 */
  dense: 12,
  /** 菜单行图标。上游 `CommitDetailsPanel.kt:382` `ROOT_ICON_SIZE = 13`，
   *  正好落进 `.menu-item-icon` 的 `flex: 0 0 14px` 槽（`style.css:126`），
   *  描边图标 13px 配 14px 盒是上游的配比，本仓菜单栏按钮（`MenuRow` 无 `icon` 字段）
   *  与 `JMenuBar` 一致不带图标，所以这一档实际只服务于齿轮/弹出菜单行。 */
  menu: 13,
  /** 控件内的通用动作图标（新建、刷新、删除、搜索、方向箭头…）。这一档占了全仓最多
   *  的用例（95 处），它是"按钮里那个图标"的默认尺寸。
   *  上游 `ActionButton` 的动作图标是 16px（`IntUiBridgeMenu.kt:107`），New UI 的运行/停止
   *  这一对有意压到 14（`style.css:235`）—— 本仓跟着压，于是 14 与 16 的分工是：
   *  **密集工具条用 14、对话框/弹层用 16**。 */
  control: 14,
  /** 复选框。上游 `CheckboxIcon.kt:42` `iconSize = 14`，`StructureFilterPopupComponent.java:72`
   *  `CHECKBOX_ICON_SIZE = 15` 是同一族里的勾选记号 —— 本仓取 14 与 checkbox 一致。 */
  checkbox: 14,
  /** 工具栏按钮的 v 分隔与筛选项。上游 `StructureFilterPopupComponent.java:72` 用的 15。 */
  toolbar: 15,
  /** 控件内的动作图标：对话框关闭按钮、主题选项行、输入框的前导图标。
   *  上游 `IntUiBridgeMenu.kt:107` `iconSize = 16.dp`（JetBrains 自己那套菜单也是 16），
   *  `InlineBanner.kt:51` `BANNER_ICON_SIZE = 16` 是同一族。 */
  action: 16,
  /** 活动条与主工具栏的图标。上游三个独立入口都返回 20：
   *  `JBUI.java:1297` `defaultExperimentalToolbarButtonIconSize()`、
   *  `:1313` `burgerMenuButtonIconSize()`、`:1337` `defaultStripeToolbarButtonIconSize()`；
   *  对应的按钮盒是 `:1277` `defaultExperimentalToolbarButtonSize()` = `size(30, 30)`，
   *  也与 `tokens.css` 的 `--toolbar-btn-size: 30px` 一致。 */
  rail: 20,
  /** 空状态插画（面板/对话框里那一大片留白中央的图标）。local。上游的空状态
   *  （`VcsToolWindowEmptyState.kt`、`EditorEmptyStateComponentProvider.kt`）根本不设图标尺寸，
   *  所以这里是纯设计决定：一个尺寸贯穿所有空状态，跨面板不再有 18/22/24 三种。 */
  artwork: 24,
  /** 整页级空状态（欢迎页"还没有近期项目"那一块）。local，比 `artwork` 大一档 —— 它是
   *  页面主角而不是某个面板里的一行说明。 */
  hero: 28,
} as const

/**
 * 出处登记。`tests/ui-icons.test.mjs` 逐条核：
 *   · 每个角色都在这张表里（漏登记 = 新增了一档没交代来源）；
 *   · 标 `upstream` 的必须带 `at`（`file:line`），标 `local` 的必须写清为什么上游没有。
 */
export const ICON_SIZE_PROVENANCE: Record<IconRole, { from: 'upstream' | 'local'; at?: string; why?: string }> = {
  chip: { from: 'local', why: '上游没有比 16 更小的图标常量；10px 是"再小就认不出形状"的下限' },
  inline: { from: 'local', why: '上游的行内次级记号走 16px 那套（IntUiBridgeMenu.kt:107），11px 是本仓为密排行高定的' },
  dense: { from: 'local', why: '折叠箭头在上游是 16px 一族；12px 对应本仓 11px 行高的密排列表' },
  menu: { from: 'upstream', at: 'vcs-log/impl/src/com/intellij/vcs/log/ui/details/commit/CommitDetailsPanel.kt:382 ROOT_ICON_SIZE = 13' },
  control: { from: 'upstream', at: 'style.css:235 显式把运行/停止图标压到 14px，与 New UI 运行 widget 一致' },
  checkbox: { from: 'upstream', at: 'platform/platform-api/src/com/intellij/util/ui/CheckboxIcon.kt:42 iconSize = 14' },
  toolbar: { from: 'upstream', at: 'vcs-log/impl/src/com/intellij/vcs/log/ui/filter/StructureFilterPopupComponent.java:72 CHECKBOX_ICON_SIZE = 15' },
  action: { from: 'upstream', at: 'jewel/ide-laf-bridge/.../IntUiBridgeMenu.kt:107 iconSize = 16.dp' },
  rail: { from: 'upstream', at: 'platform/util/ui/src/com/intellij/util/ui/JBUI.java:1297 / :1313 / :1337 全部返回 20' },
  artwork: { from: 'local', why: '上游空状态（VcsToolWindowEmptyState.kt）不设图标尺寸，24 是本仓自己的统一决定' },
  hero: { from: 'local', why: '上游没有整页级空状态图标的度量；比 artwork 大一档是本仓的设计决定' },
}

/** 角色 → `tokens.css` 里的自定义属性名。测试用它守住"CSS 与本模块永远同步"。 */
export const ICON_SIZE_CSS_VAR: Record<IconRole, string> = {
  chip: '--icon-size-chip',
  inline: '--icon-size-inline',
  dense: '--icon-size-dense',
  menu: '--icon-size-menu',
  control: '--icon-size-control',
  checkbox: '--icon-size-checkbox',
  toolbar: '--icon-size-toolbar',
  action: '--icon-size-action',
  rail: '--icon-size-rail',
  artwork: '--icon-size-artwork',
  hero: '--icon-size-hero',
}

/**
 * 裸像素 → 角色。批量的 `:size="14"` → `:size="iconSize.run"` 迁移用它。
 * 刻意**不做**成运行时函数：模板里 `iconSize.menu` 是属性访问，导出函数会让
 * `vue-tsc` 报 TS2339（`Property 'menu' does not exist on type '(role) => number'`）。
 * 迁移脚本是一次性的，留在仓库里反而会被人再用一次。
 */
export const ICON_ROLE_BY_PX: Record<number, IconRole> = {
  10: 'chip',
  11: 'inline',
  12: 'dense',
  13: 'menu',
  14: 'control',
  15: 'toolbar',
  16: 'action',
  20: 'rail',
  24: 'artwork',
  28: 'hero',
}

/**
 * 描边宽度。上游的 `IconManager` 不调 lucide 这类描边图的 stroke，但 IDEA 新 UI 的
 * 活动条图标实测偏细（`style.css:265` 原来写死 `1.7`）。1.7 是唯一定过的值，
 * 20px 图标配 1.7 换算下来是 0.085em，而全仓其余图标（13px 配 lucide 默认 2）是
 * 0.154em —— 轨道上的图标笔画细了近一倍，视觉上不属于同一套。抬到 2 之后两者对齐，
 * 也就是"跟 lucide 默认值一样"，所以这里不需要额外的自定义属性，直接给常量。
 */
export const ICON_STROKE = 2

/**
 * 模板里直接用这个对象：`:size="iconSize.menu"`。
 * （先前导出的是一个 `iconSize(role)` **函数**，于是模板里 `iconSize.menu` 被解析成
 *  "取函数的 menu 属性" —— `vue-tsc` 报 TS2339。这里是踩过的坑，别再改回函数。）
 */
export const iconSize = ICON_SIZE

/**
 * 禁止出现的 Unicode 字形 —— 这些曾被当图标直接渲染进模板。
 * 保留成一张表是为了让门禁测试能报出**位置**而不只是"有字形"。
 *
 * 注意：正文文案里的 `→`、`×`（乘法/时间轴）、`·` 都不在此列 —— 那是文字，不是图标。
 */
export const FORBIDDEN_ICON_GLYPHS: ReadonlyArray<{ glyph: string; use: string }> = [
  { glyph: '✓', use: '勾选记号 → lucide `Check`（`.menu-item-icon` 槽位，见 App.vue:2013/2018 的既有写法）' },
  { glyph: '✔', use: '勾选记号 → lucide `Check`' },
  { glyph: '✗', use: '测试失败 → lucide `CircleX`（`TestRunnerPanel.vue` 既有 `.testrun-outcome.failed` 着色）' },
  { glyph: '✖', use: '同上' },
  { glyph: '▾', use: '展开箭头 → lucide `ChevronDown`（`.tree-chevron`，见 `FileTree.vue:172`）' },
  { glyph: '▸', use: '折叠箭头 → lucide `ChevronRight`（同 `FileTree.vue:172`）' },
  { glyph: '×', use: '关闭记号 → lucide `X`（`DiffView.vue:49` 的既有写法）' },
  { glyph: '●', use: '"正在运行"记号 → `src/components/RunningDot.vue`（lucide `Circle` 填色 + `--accent`）。字体里的实心点大小由**字体**决定、换字体就变，而且和旁边的数字同色，读起来就是"又一个数字"' },
]