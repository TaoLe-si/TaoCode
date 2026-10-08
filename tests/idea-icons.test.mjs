// IDEA 原样图标（`src/components/icons/`）的门禁。
//
// 这一批把工具窗口条 / 内容标签 / 状态栏弹层的图标从 lucide 换成 IDEA 的 expui 副本
// （原因：lucide 是 24 格描边图，与 IDEA 的 16/20 格双形态不是同一套形状）。这条门禁守三件事：
//
//   ① **几何是源码的**：`ideaIconData.ts` 是生成物，里面每一格的 path 数据必须与参考树里
//      那份 SVG **逐字节**一致（颜色那处 `currentColor` 改写除外）。手改产物 / 抄错坐标 ⇒ 红。
//   ② **接线**：工具窗口注册表那 10 条 id 的 `icon` 必须指向 expui 副本，不许退回 lucide
//      （改回 lucide 也能编过、也渲染得出来 —— 只有这条能拦）。
//   ③ **16/20 双形态的选表规则**：`size >= 20` 取 `@20x20` 那份（上游 `loadIconCustomVersion`
//      的规则），且 `@20x20` 那份**不是** 16 格的等比放大（形状不同 ⇒ viewBox 内坐标不同）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { loadModule, loadSfc } from './vue-sfc-loader.mjs'

const require = createRequire(import.meta.url)
const {
  IDEA_ICON_16, IDEA_ICON_20, IDEA_ICON_20_NAMES, IDEA_ICON_NAMES,
  IDEA_ICON_STATUS, IDEA_ICON_STATUS_NAMES, ideaIconShape, ideaStatusIconSvg,
} = require('../src/components/icons/ideaIconData.ts')
const { TOOL_WINDOW_IDEA_ICON, BOTTOM_CONTENT_IDEA_ICON } = require('../src/components/icons/index.ts')
const { TOOL_WINDOW_REGISTRY, toolIcons } = require('../src/toolWindowMeta.ts')
const { gutterIconAppearance, GUTTER_ICON_ORDER } = require('../src/gutterIcons.ts')

const REF = process.env.TAOCODE_REF_TREE || 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const refAvailable = existsSync(REF)

/** 生成器做的那处颜色改写：亮/暗面单色 → currentColor，语义色 → currentColor。 */
function normalize(svgBody) {
  return svgBody
    .replace(/#6C707E/g, 'currentColor').replace(/#CED0D6/g, 'currentColor')
    .replace(/#E55765/g, 'currentColor').replace(/#DB5C5C/g, 'currentColor')
    .replace(/#FFAF0F/g, 'currentColor').replace(/#F2C55C/g, 'currentColor')
    .replace(/#4682FA/g, 'currentColor').replace(/#548AF7/g, 'currentColor')
    .replace(/#55A76A/g, 'currentColor').replace(/#7F8B91/g, 'currentColor')
}

/** 参考树里那份 SVG 的子元素字面量（与生成器同一口径）。 */
function refBody(relativePath) {
  const svg = readFileSync(`${REF}/${relativePath}`, 'utf8')
  const inner = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)
  return normalize(inner[1]).split('\n').map(line => line.trim()).filter(Boolean)
}

test('ideaIconData 是生成物：每格的 path 数据与参考树逐字节一致', { skip: !refAvailable && '参考树不在本机' }, () => {
  for (const [name, shape] of Object.entries({ ...IDEA_ICON_16, ...IDEA_ICON_20, ...IDEA_ICON_STATUS })) {
    assert.ok(shape.source, `${name} 没有登记上游出处`)
    assert.deepEqual(shape.body, refBody(shape.source),
      `${name} 与上游 ${shape.source} 不一致（产物被手改了？重跑 scripts/gen-idea-icons.mjs）`)
  }
})

test('20 格表是 16 格表的子集（有变体的才进 20 格表，其余退回 16 格）', () => {
  // 上游 `@20x20` 变体只给工具窗口条那一族画；菜单勾选记号（`checked`）只有 16 格一份。
  // 所以 20 格表的每个键都必须在 16 格表里（`ideaIconShape` 的退回路径才成立），反之不然。
  const missing = IDEA_ICON_20_NAMES.filter(name => !IDEA_ICON_NAMES.includes(name))
  assert.deepEqual(missing, [], '20 格表里有 16 格表没有的名字 —— 退回路径会拿到 undefined')
  assert.ok(IDEA_ICON_20_NAMES.length >= 10, '工具窗口条那 10 个 id 都得有 20 格变体')
  assert.ok(IDEA_ICON_16.checked, 'checked 是菜单勾选记号，16 格那份必须在')
})

test('16/20 双形态不是等比放大：同一名字两份的 path 数据不同', () => {
  // 上游 `loadIconCustomVersion`（customIconUtil.kt:44-62）在需要 20px 时优先去找 `@20x20.svg`，
  // 找不到才缩放 16 格那份 —— 所以 20 格是**手绘的另一份形状**。若两者逐字节相同，
  // 说明生成器把 16 格复制了两份（那就等于在用放大版，是错的）。
  for (const name of IDEA_ICON_20_NAMES) {
    assert.notDeepEqual(IDEA_ICON_20[name].body, IDEA_ICON_16[name].body,
      `${name} 的 20 格与 16 格逐字节相同 —— 那不是上游的 @20x20 变体`)
  }
})

test('取表规则：size >= 20 走 20 格，否则走 16 格；没有 20 格变体时退回 16 格', () => {
  assert.equal(ideaIconShape('project', 20).viewBox, IDEA_ICON_20.project.viewBox)
  assert.equal(ideaIconShape('project', 16).viewBox, IDEA_ICON_16.project.viewBox)
  assert.equal(ideaIconShape('project', 13).viewBox, IDEA_ICON_16.project.viewBox, '小于 20 一律 16 格')
  // `checked` 只在 16 格表里（菜单勾选记号，上游没有 20 格变体）⇒ 退回 16 格而不是 undefined。
  assert.equal(ideaIconShape('checked', 20).viewBox, IDEA_ICON_16.checked.viewBox)
  assert.equal(ideaIconShape('不存在', 16), undefined)
})

test('工具窗口注册表的 10 条 id 全部指向 IDEA 原样图标，不许退回 lucide', () => {
  const ids = TOOL_WINDOW_REGISTRY.map(entry => entry.id)
  assert.deepEqual(Object.keys(TOOL_WINDOW_IDEA_ICON).sort(), [...ids].sort(),
    '注册表的每一条 id 都要在 TOOL_WINDOW_IDEA_ICON 里有对应图标名')
  for (const entry of TOOL_WINDOW_REGISTRY) {
    const iconName = TOOL_WINDOW_IDEA_ICON[entry.id]
    assert.ok(IDEA_ICON_16[iconName], `${entry.id} → ${iconName} 不在 16 格表里`)
    // 图标组件是薄壳对象（`name` 形如 `IdeaIcon_<icon>`），lucide 组件的名字是 lucide 的图标名。
    assert.match(String(entry.icon?.name ?? ''), /^IdeaIcon_/,
      `${entry.id} 的图标不是 expui 副本（退回 lucide 了？）：${entry.icon?.name}`)
    assert.equal(entry.icon?.name, `IdeaIcon_${iconName}`)
    assert.equal(toolIcons[entry.id], entry.icon)
  }
})

test('底部内容那几格也走 IDEA 原样图标（出处登记在 BOTTOM_CONTENT_IDEA_ICON）', () => {
  assert.deepEqual(Object.keys(BOTTOM_CONTENT_IDEA_ICON).sort(),
    ['hierarchy', 'output', 'problems', 'references', 'run', 'terminal'])
  for (const [id, iconName] of Object.entries(BOTTOM_CONTENT_IDEA_ICON)) {
    assert.ok(IDEA_ICON_16[iconName], `${id} → ${iconName} 不在 16 格表里`)
  }
  // 上游那几格的出处：output 借 Messages 工具窗口、references 借 Find 窗口，
  // 其余各自有 ToolWindow* 图标（见 components/icons/index.ts 的注释）。
  assert.equal(BOTTOM_CONTENT_IDEA_ICON.output, 'messages')
  assert.equal(BOTTOM_CONTENT_IDEA_ICON.references, 'find')
})

test('语义色表覆盖装订线五档，且每档都有上游出处', () => {
  // `success`（`AllIcons.Status.Success`，`AllIcons.java:1432`）不在装订线五档里：
  // 它是「全部后台任务已完成」那条标签的图标（`TasksFinishedDecorator.kt:36`）。
  assert.deepEqual([...IDEA_ICON_STATUS_NAMES].sort(),
    ['bookmark', 'breakpoint', 'error', 'info', 'success', 'warning'])
  for (const [name, shape] of Object.entries(IDEA_ICON_STATUS)) {
    assert.match(shape.source, /^platform\/icons\/src\/expui\/(status|gutter|breakpoints)\//,
      `${name} 的出处不是 expui 的语义色目录`)
  }
  // 装订线五档（GUTTER_ICON_ORDER）逐档映射到语义色表里的一个名字。
  for (const kind of GUTTER_ICON_ORDER) {
    const look = gutterIconAppearance(kind)
    assert.ok(IDEA_ICON_STATUS[look.ideaIcon], `${kind} → ${look.ideaIcon} 不在语义色表里`)
  }
})

test('语义色图标的内联 SVG 走原样 path（含色块上的白色前景）', () => {
  const svg = ideaStatusIconSvg('error', 'var(--error)', 16)
  assert.match(svg, /viewBox="0 0 16 16"/)
  assert.match(svg, /style="color:var\(--error\)"/, '主色由调用方给（主题变量）')
  assert.match(svg, /fill="currentColor"/, '色块取 currentColor')
  assert.match(svg, /fill="white"/, '色块上的前景保留白色（对比关系不是主题色）')
  assert.equal(ideaStatusIconSvg('不存在', '#000', 16), '', '拼错的名字返回空串，不静默画别的形状')
})

test('接线：ContentComboLabel / ToolStripe / 注册表都真的 import 了 expui 图标组件', () => {
  const combos = readFileSync('src/components/ContentComboLabel.vue', 'utf8')
  assert.match(combos, /from '\.\/icons\/toolWindowIcons\.ts'/)
  assert.doesNotMatch(combos, /\b(Workflow|SquareTerminal|TriangleAlert|ListTree|Play)\b/,
    '固定内容还留着 lucide 顶替件（Workflow/Play/TriangleAlert/ListTree/SquareTerminal）')
  const stripe = readFileSync('src/components/ToolStripe.vue', 'utf8')
  assert.match(stripe, /IdeaMoreHorizontalIcon/, '侧条「更多」按钮要用上游的 moreHorizontal')
  assert.doesNotMatch(stripe, /MoreHorizontal.*lucide-vue-next/, 'MoreHorizontal 还从 lucide 来')
  const meta = readFileSync('src/toolWindowMeta.ts', 'utf8')
  assert.doesNotMatch(meta, /from 'lucide-vue-next'/, '注册表不再从 lucide 取图标')
})
// --- 真渲染路径（不是数据表，也不是源码字符串）-----------------------------------------------

test('IdeaIcon 真的渲染出上游那条 path（16 格与 20 格各取一份）', async () => {
  const { IdeaIcon } = loadModule('src/components/icons/IdeaIcon.ts')
  const html16 = await renderToString(createSSRApp({ render: () => h(IdeaIcon, { name: 'project', size: 16 }) }))
  assert.match(html16, /viewBox="0 0 16 16"/)
  assert.match(html16, /width="16" height="16"/)
  assert.match(html16, /class="idea-icon"/)
  // 16 格那份是描边路径（stroke="currentColor"），坐标必须来自上游而不是 lucide 的 24 格。
  assert.ok(html16.includes(IDEA_ICON_16.project.body[0]), '渲染出来的不是上游那条 path')
  const html20 = await renderToString(createSSRApp({ render: () => h(IdeaIcon, { name: 'project', size: 20 }) }))
  assert.match(html20, /viewBox="0 0 20 20"/)
  assert.ok(html20.includes(IDEA_ICON_20.project.body[0]), '20px 时该取 @20x20 那份')
  // 名字不存在时渲染空，不画一个假图标（静默画空比报错更难查）。
  const empty = await renderToString(createSSRApp({ render: () => h(IdeaIcon, { name: '不存在', size: 16 }) }))
  assert.doesNotMatch(empty, /<svg/, '名字不存在时不该画出任何 svg（SSR 只会留一个片段锚点注释）')
})

test('工具窗口条按钮渲染的是 IDEA 图标，不是 lucide 的 24 格图标', async () => {
  const { component: ToolStripe } = loadSfc('src/components/ToolStripe.vue')
  const icons = { files: toolIcons.files, git: toolIcons.git }
  const html = await renderToString(createSSRApp({
    render: () => h(ToolStripe, {
      side: 'left', ids: ['files', 'git'], labels: { files: '项目', git: '源代码管理' }, icons,
      mnemonicOf: () => undefined, isDisabled: () => false, isActive: () => false, dragging: null,
      isDropBefore: () => false, dropAtEnd: false, width: 0, showNames: false, compact: false,
      moreIds: [], moreOnThisSide: true,
    }),
  }))
  // 侧条图标 20px（`iconSize.rail`）⇒ 取 @20x20 那份（`viewBox="0 0 20 20"`）。
  assert.match(html, /viewBox="0 0 20 20"/, '侧条按钮没画出 IDEA 的 20 格图标')
  assert.ok(html.includes(IDEA_ICON_20.project.body[0]), '项目按钮画的不是上游 project@20x20 那条 path')
  assert.ok(html.includes(IDEA_ICON_20.commit.body[0]), '源代码管理按钮画的不是上游 commit@20x20 那条 path')
  // lucide 的 24 格图标会带 `lucide-*` 类 —— 这一族不该再出现它。
  assert.doesNotMatch(html, /class="lucide/, '侧条又混进 lucide 图标了')
})
