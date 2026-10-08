// 从参考树里把 IDEA expui 图标的 path 数据原样搬进 `src/components/icons/ideaIconData.ts`。
//
// 为什么是生成物而不是手抄：几何必须是**源码的**（本仓铁律），手抄 35 份 path 一定会在某一次
// 编辑里漂一个字符，而描边图漂 0.1 个坐标肉眼看不出来、门禁也抓不到。生成器把「从哪来」写进
// 产物（每个图标带 `source`），`tests/idea-icons.test.mjs` 再回参考树逐字节比对。
//
// 用法：`node scripts/gen-idea-icons.mjs`
//   · 参考树不在默认位置时用环境变量 `TAOCODE_REF_TREE` 指过去；
//   · 参考树不存在时**不写文件**（避免在没参考树的机器上把产物清空），退出码 2。
//
// 颜色改写分两档，都在下面逐条登记：
//   · **单色图标**（工具窗口条那一族、菜单行图标）：上游把颜色写死成亮面 `#6C707E` / 暗面
//     `#CED0D6`，本仓换成 `currentColor` —— 配色归主题变量管。
//   · **语义色图标**（status/error · warning · info、gutter/bookmark、breakpoints/breakpoint）：
//     上游自己就写死了语义色（`#E55765` 红 / `#FFAF0F` 黄 / `#4682FA` 蓝），
//     **形状与配色都是源码的**。本仓把"主色"换成 `currentColor`（由调用方按主题变量给），
//     只保留压在色块上的**白色前景**（那是色块与前景的对比关系，不是主题色）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const REF = process.env.TAOCODE_REF_TREE || 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const OUT = join(root, 'src/components/icons/ideaIconData.ts')

/** 单色图标：上游那两种前景色 → currentColor。`#7F8B91` 是 `process/step_passive.svg`
 *  （状态栏进程部件的空闲态）那一支独有的灰，同样交给主题变量。 */
const MONO = [['#6C707E', 'currentColor'], ['#CED0D6', 'currentColor'], ['#7F8B91', 'currentColor']]
/** 语义色图标：主色 → currentColor，白色前景原样留着（色块上的对比关系）。 */
const SEMANTIC = [['#6C707E', 'currentColor'], ['#CED0D6', 'currentColor'],
  ['#E55765', 'currentColor'], ['#DB5C5C', 'currentColor'],
  ['#FFAF0F', 'currentColor'], ['#F2C55C', 'currentColor'],
  ['#4682FA', 'currentColor'], ['#548AF7', 'currentColor'],
  // `status/success.svg` 是绿盘 + 白勾（`AllIcons.Status.Success`，`AllIcons.java:1432`），
  // 绿色同样换成 currentColor：调用方按 `--success` 给，暗面才不会拿亮面那支绿。
  ['#55A76A', 'currentColor']]

/** 16x16 形态（`<name>.svg`）——菜单行 / 对话框 / 工具窗口内容标签用。 */
const ICONS_16 = [
  ['project', 'platform/icons/src/expui/toolwindows/project.svg'],
  ['commit', 'platform/icons/src/expui/toolwindows/commit.svg'],
  ['vcs', 'platform/icons/src/expui/toolwindows/vcs.svg'],
  ['find', 'platform/icons/src/expui/toolwindows/find.svg'],
  ['todo', 'platform/icons/src/expui/toolwindows/todo.svg'],
  ['structure', 'platform/icons/src/expui/toolwindows/structure.svg'],
  ['bookmarks', 'platform/icons/src/expui/toolwindows/bookmarks.svg'],
  ['debug', 'platform/icons/src/expui/toolwindows/debug.svg'],
  ['notifications', 'platform/icons/src/expui/toolwindows/notifications.svg'],
  ['gradle', 'plugins/gradle/resources/icons/expui/gradle.svg'],
  ['run', 'platform/icons/src/expui/toolwindows/run.svg'],
  ['problems', 'platform/icons/src/expui/toolwindows/problems.svg'],
  ['hierarchy', 'platform/icons/src/expui/toolwindows/hierarchy.svg'],
  ['terminal', 'plugins/terminal/resources/icons/expui/toolwindow/terminal.svg'],
  ['messages', 'platform/icons/src/expui/toolwindows/messages.svg'],
  // Agent 对话工具窗口：上游 `AllIcons.ToolWindowAskAI`（`platform/util/ui/src/com/intellij/icons/AllIcons.java:1494`
  // = `expui/toolwindows/toolWindowAskAI.svg`，`AllIconDescriptors.kt:1455` 同源）—— 三叶扇形，
  // 就是 IDEA 里 AI 助手的工具窗口图标。本仓的 Agent 对话窗口对应它，所以取原样图而不是 lucide 机器人。
  ['askAI', 'platform/icons/src/expui/toolwindows/toolWindowAskAI.svg'],
  ['build', 'platform/icons/src/expui/toolwindows/build.svg'],
  ['moreHorizontal', 'platform/icons/src/expui/general/moreHorizontal.svg'],
  ['checked', 'platform/icons/src/expui/actions/checked.svg'],
  // 状态栏进程部件的**空闲**态：上游 `AsyncProcessIcon` 挂起的图标是
  // `AllIcons.Process.Step_passive`（`AllIcons.java:1269` = `process/step_passive.svg`），
  // `InfoAndProgressPanel.updateProgressIcon`（`:562-571`）在没有任务或省电模式下调 `suspend()`
  // 就切到它 —— 不是勾。
  ['stepPassive', 'platform/icons/src/process/step_passive.svg'],
  // 主菜单按钮（汉堡）：上游 `MainMenuWithButton.getButtonIcon()`（`:142`）在**未合并**主菜单时
  // 返回 `AllIcons.General.WindowsMenu_20x20`（`AllIcons.java:683` = `expui/general/windowsMenu@20x20.svg`），
  // 合并时返回 `AllIcons.General.ChevronRight`（`:550` = `expui/general/chevronRight.svg`）——
  // 前者只有 20 格一份，后者只有 16 格一份，所以两张表各进一个。
  ['chevronRight', 'platform/icons/src/expui/general/chevronRight.svg'],
  // 16 格那一份：`AllIcons.General.Menu`（`AllIcons.java:627` = `expui/general/menu.svg`）——
  // 上游没有 `windowsMenu.svg`（只有 `@20x20`），所以这是**同族另一支**的手绘形状，
  // 不是 20 格那份的等比缩放（两者线条数都不同：3 条 vs 4 条）。20 格表里放 windowsMenu@20x20
  // 是有据的（主菜单按钮实测就是 20px），16 格这一支只作 <20px 的退路。
  ['mainMenu', 'platform/icons/src/expui/general/menu.svg'],
  // 主工具栏右端两颗（`MainToolbarNewUI` 的 SearchEverywhere + SettingsEntryPoint）：
  // 上游 `AllIcons.Actions.Find`（`AllIcons.java:67` = `expui/general/search.svg`）与
  // `AllIcons.General.Settings`（`:660` = `expui/general/settings.svg`），两者都有 `@20x20` 变体。
  ['search', 'platform/icons/src/expui/general/search.svg'],
  ['settings', 'platform/icons/src/expui/general/settings.svg'],
  // 三方合并编辑器的「接受左侧 / 接受右侧」：上游 `intellij.platform.ide.actions.xml:54-55`
  // 的 `Diff.ApplyLeftSide` = `AllIcons.Diff.ArrowRight`、`Diff.ApplyRightSide` = `AllIcons.Diff.Arrow`
  // （`AllIcons.java:424/427`，都是 14 格图）。原先本仓画的是一个**勾** —— 那是"接受 = 勾"的
  // 发明形状；上游这两颗指的是"把左边/右边**搬过去**"的方向箭头（左箭头指右、右箭头指左）。
  ['applyLeftSide', 'platform/icons/src/expui/diff/arrowRight@14x14.svg'],
  ['applyRightSide', 'platform/icons/src/expui/diff/arrow@14x14.svg'],
  // 工具窗口齿轮（New UI）：`ToolWindowImpl.kt:848-852` 的 `GearActionGroup` 在
  // `toolWindowManager.isNewUi` 时把图标设成 `AllIcons.Actions.More`
  // （`AllIcons.java:117` = `expui/general/moreVertical.svg`）—— 是**竖排三点**，不是齿轮。
  // 老 UI 那一支才是 `AllIcons.General.GearPlain`（`AllIcons.java:581` = `settings.svg`）。
  ['moreVertical', 'platform/icons/src/expui/general/moreVertical.svg'],
]

/** 20x20 形态（`<name>@20x20.svg`）——工具窗口条与主工具栏用（上游手绘的第二份形状）。 */
const ICONS_20 = [
  ['project', 'platform/icons/src/expui/toolwindows/project@20x20.svg'],
  ['commit', 'platform/icons/src/expui/toolwindows/commit@20x20.svg'],
  ['vcs', 'platform/icons/src/expui/toolwindows/vcs@20x20.svg'],
  ['find', 'platform/icons/src/expui/toolwindows/find@20x20.svg'],
  ['todo', 'platform/icons/src/expui/toolwindows/todo@20x20.svg'],
  ['structure', 'platform/icons/src/expui/toolwindows/structure@20x20.svg'],
  ['bookmarks', 'platform/icons/src/expui/toolwindows/bookmarks@20x20.svg'],
  ['debug', 'platform/icons/src/expui/toolwindows/debug@20x20.svg'],
  ['notifications', 'platform/icons/src/expui/toolwindows/notifications@20x20.svg'],
  ['gradle', 'plugins/gradle/resources/icons/expui/gradle@20x20.svg'],
  ['run', 'platform/icons/src/expui/toolwindows/run@20x20.svg'],
  ['problems', 'platform/icons/src/expui/toolwindows/problems@20x20.svg'],
  ['hierarchy', 'platform/icons/src/expui/toolwindows/hierarchy@20x20.svg'],
  ['terminal', 'plugins/terminal/resources/icons/expui/toolwindow/terminal@20x20.svg'],
  ['messages', 'platform/icons/src/expui/toolwindows/messages@20x20.svg'],
  // Agent 对话工具窗口的 20 格形态（上游同一枚 `AllIcons.ToolWindowAskAI` 的 `@20x20` 手绘档）。
  ['askAI', 'platform/icons/src/expui/toolwindows/toolWindowAskAI@20x20.svg'],
  ['build', 'platform/icons/src/expui/toolwindows/build@20x20.svg'],
  ['moreHorizontal', 'platform/icons/src/expui/general/moreHorizontal@20x20.svg'],
  // 主菜单按钮（未合并主菜单那一态）：`MainMenuWithButton.getButtonIcon()` 在
  // `isMergedMainMenu()` 为假时返回 `AllIcons.General.WindowsMenu_20x20`（`AllIcons.java:683`），
  // 而那个按钮的尺寸是 `JBUI.burgerMenuButtonIconSize()` = 20 —— 所以命中的就是这一份 20 格图。
  ['mainMenu', 'platform/icons/src/expui/general/windowsMenu@20x20.svg'],
  // 主工具栏右端两颗的 20 格形态（`loadIconCustomVersion` 优先取 `@20x20`）。
  ['search', 'platform/icons/src/expui/general/search@20x20.svg'],
  ['settings', 'platform/icons/src/expui/general/settings@20x20.svg'],
]

/**
 * 语义色图标（`IDEA_ICON_STATUS`）—— 装订线（gutter）与诊断用。
 * 上游出处：`AllIcons.General.Error` = `expui/status/error.svg`（`AllIcons.java:570`）、
 * `Warning` = `status/warning.svg`（`:679`）、`Information` = `status/info.svg`（`:589`）、
 * 书签 = `expui/gutter/bookmark.svg`、断点 = `expui/breakpoints/breakpoint.svg`。
 */
const ICONS_STATUS = [
  ['error', 'platform/icons/src/expui/status/error.svg'],
  ['warning', 'platform/icons/src/expui/status/warning.svg'],
  ['info', 'platform/icons/src/expui/status/info.svg'],
  ['success', 'platform/icons/src/expui/status/success.svg'],
  ['bookmark', 'platform/icons/src/expui/gutter/bookmark.svg'],
  ['breakpoint', 'platform/icons/src/expui/breakpoints/breakpoint.svg'],
]

/** 读一份上游 SVG，抽出 viewBox 与子元素字面量，按 `subs` 改颜色。 */
function grab(relativePath, subs) {
  const svg = readFileSync(join(REF, relativePath), 'utf8')
  const inner = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)
  const viewBox = svg.match(/viewBox="([^"]+)"/)
  if (!inner || !viewBox) throw new Error(`不是一份可解析的 SVG：${relativePath}`)
  let body = inner[1].trim()
  for (const [from, to] of subs) body = body.split(from).join(to)
  return { viewBox: viewBox[1], body: body.split('\n').map(line => line.trim()).filter(Boolean) }
}

function block(entries, subs) {
  const out = []
  for (const [name, path] of entries) {
    const { viewBox, body } = grab(path, subs)
    out.push(`  ${name}: {`)
    out.push(`    source: '${path}',`)
    out.push(`    viewBox: '${viewBox}',`)
    out.push('    body: [')
    for (const line of body) out.push(`      ${JSON.stringify(line)},`)
    out.push('    ],')
    out.push('  },')
  }
  return out.join('\n')
}

const HEAD = `// IDEA expui 图标集的**逐字节副本**（几何层）。
//
// 这份文件是**生成物**，不要手改：\`node scripts/gen-idea-icons.mjs\` 从参考树
// （D:/Backup/Downloads/intellij-community-master）的 SVG 里把 path 数据原样搬出来，
// 只改颜色（规则见下面两张表的注释）。
//
// 为什么不用 lucide：lucide 是 24 格描边图，与 IDEA 的 16/20 格双形态图标**不是同一套形状**。
// 工具窗口条那 11 个图标在 IDEA 里是「16px 细描边 + 20px 实心」两种形态
// （\`loadIconCustomVersion\` 按目标尺寸去找 \`@20x20\` 变体，见
// platform/core-ui/src/ui/icons/customIconUtil.kt:44-62），尺寸档 \`rail\` = 20 恰好命中
// 20 格那一份 —— 用 lucide 顶替等于换了图形。

/** 一个图标：上游 SVG 的 viewBox + 那几条 path/circle/rect（原样，只改颜色）。 */
export interface IdeaIconShape {
  /** 上游文件路径（相对参考树根），判据用它回查参考树确认 path 数据没被改过。 */
  source: string
  viewBox: string
  /** SVG 子元素字面量（\`<path …/>\` / \`<circle …/>\`），**逐字节**照上游。 */
  body: readonly string[]
}

/**
 * 16x16 形态：菜单行 / 对话框 / 工具窗口内容标签（上游 \`*.svg\`）。
 *
 * 颜色：上游写死的亮面 \`#6C707E\` / 暗面 \`#CED0D6\` 已换成 \`currentColor\`，
 * 于是 \`color\` 由调用方的主题变量决定，明暗两套主题自动生效。
 */
export const IDEA_ICON_16: Record<string, IdeaIconShape> = {`

const MID = `
}

/**
 * 20x20 形态：工具窗口条与主工具栏（上游 \`*@20x20.svg\`）。
 *
 * 上游 \`loadIconCustomVersion\`（\`customIconUtil.kt:44-62\`）在需要 20px 时**优先去找**
 * \`<name>@20x20.svg\`，找不到才把 16 格那份等比放大 —— 所以 20 格那一份不是「放大版」，
 * 而是 JetBrains 手绘的另一份形状（笔画更粗、细节更少）。本仓照这个规则取图。
 */
export const IDEA_ICON_20: Record<string, IdeaIconShape> = {`

const STATUS_MID = `
}

/**
 * 语义色图标：装订线（gutter）与诊断的色块。
 *
 * 与上面两张表的差别只在颜色：上游这几张 SVG 自己就写死了语义色
 * （错误 \`#E55765\` / 警告 \`#FFAF0F\` / 信息 \`#4682FA\` / 书签与断点的色块）——
 * **形状与配色都是源码的**。本仓把主色换成 \`currentColor\`（调用方按主题变量给，
 * 于是明暗主题各自生效），只保留压在色块上的**白色前景**（那是色块与前景的对比关系，
 * 不是主题色）。出处逐条：\`AllIcons.java:570\` Error / \`:679\` Warning / \`:589\` Information。
 */
export const IDEA_ICON_STATUS: Record<string, IdeaIconShape> = {`

const TAIL = `
}

/** 有 20 格变体的图标名（工具窗口条那一族）。没有的名字只能走 16 格。 */
export const IDEA_ICON_20_NAMES: readonly string[] = Object.keys(IDEA_ICON_20)

/** 全部单色图标名（16 格表为准）。 */
export const IDEA_ICON_NAMES: readonly string[] = Object.keys(IDEA_ICON_16)

/** 全部语义色图标名（gutter 那一族）。 */
export const IDEA_ICON_STATUS_NAMES: readonly string[] = Object.keys(IDEA_ICON_STATUS)

/** 取一张表里的一格；名字不在表里返回 undefined（调用方该在渲染前就报错，不要静默画空）。 */
export function ideaIconShape(name: string, size: 16 | 20): IdeaIconShape | undefined {
  const table = size === 20 ? IDEA_ICON_20 : IDEA_ICON_16
  return table[name] ?? (size === 20 ? IDEA_ICON_16[name] : undefined)
}

/** 取一个语义色图标（gutter 那一族）。 */
export function ideaStatusIconShape(name: string): IdeaIconShape | undefined {
  return IDEA_ICON_STATUS[name]
}

/**
 * 语义色图标 → 内联 SVG 字符串（\`src/editorGutterIcons.ts\` 的 gutter marker 用）。
 *
 * 为什么在这里生成字符串而不是在 gutter 模块里拼：geometry 只此一处，
 * gutter 那边只负责给一个主题色（\`color\`）。改错形状要改的是参考树里的 SVG，
 * 不是某个渲染模块。
 */
export function ideaStatusIconSvg(name: string, color: string, size: number): string {
  const shape = IDEA_ICON_STATUS[name]
  if (!shape) return ''
  return \`<svg viewBox="\${shape.viewBox}" width="\${size}" height="\${size}" fill="none" style="color:\${color}" aria-hidden="true">\${shape.body.join('')}</svg>\`
}
`

if (!existsSync(REF)) {
  console.error(`参考树不存在：${REF}（用 TAOCODE_REF_TREE 指过去）—— 不写产物。`)
  process.exit(2)
}

const content = `${HEAD}\n${block(ICONS_16, MONO)}${MID}\n${block(ICONS_20, MONO)}${STATUS_MID}\n${block(ICONS_STATUS, SEMANTIC)}${TAIL}`
writeFileSync(OUT, content)
console.log(`写出 ${OUT}：${ICONS_16.length} 个 16 格 + ${ICONS_20.length} 个 20 格 + ${ICONS_STATUS.length} 个语义色，${content.split('\n').length} 行`)