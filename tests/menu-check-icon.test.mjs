// 菜单行勾选记号 = IDEA 原样图标，不是 lucide 的 24 格图。
//
// 上游真身：`AllIcons.Actions.Checked` = `expui/actions/checked.svg`（`AllIcons.java:39`，
// `PlatformIcons.CHECK_ICON:65`）。挂法有两处可见来源：
//   · `JBCefMenuAdapter.kt:51` —— JCEF 菜单项 `checked` 为真时画它，否则留 `EmptyIcon.ICON_16`；
//   · `ActionStepBuilder.calcRawIcons`（`:157-160`）—— `Toggleable.isSelected(presentation)` 时
//     `icon = LafIconLookup.getIcon("checkmark")`（那是同一套 LAF 勾，win10 那份就是
//     `plugins/laf/win10/resources/icons/checkmark.svg`，形状与 `checked.svg` 同为一条对勾）。
//
// 为什么必须换：lucide 的 `Check` 是 24 格描边图（`viewBox="0 0 24 24"`），
// IDEA 的勾是 16 格（`viewBox="0 0 16 16"`）。同一套菜单里混两种勾，笔画粗细与对勾角度都不同。
//
// 这条门禁守三件事：
//   ① 菜单行槽（`.menu-item-icon` / `.menu-check` / `bp-check` / `gear-on`）里不再出现 lucide `Check`；
//   ② 真渲染路径：`IdeaCheckedIcon` 画出的 svg 带 `viewBox="0 0 16 16"` 与上游那条 path 逐字节；
//   ③ 反例：`SourceControl.vue` 的空状态**不是**菜单勾（`iconSize.artwork` 的插画），
//      不在这条替换范围内 —— 门禁把它排除，免得下一批误改。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { loadModule } from './vue-sfc-loader.mjs'

const require = createRequire(import.meta.url)
const { IDEA_ICON_16 } = require('../src/components/icons/ideaIconData.ts')
const { IdeaCheckedIcon } = require('../src/components/icons/toolWindowIcons.ts')

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function vueFiles(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) vueFiles(p, out)
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}
const rel = file => file.replace(/\\/g, '/').replace(/^.*?\/src\//, 'src/')
const read = file => readFileSync(file, 'utf8')

test('全仓不再从 lucide 取菜单勾选记号（`Check` 只剩空状态插画那一处）', () => {
  const bad = []
  for (const file of vueFiles()) {
    const source = read(file)
    // lucide 的 `Check` 只能出现在 SourceControl 的空状态里（那是 artwork 插画，不是菜单槽）。
    const lucide = /import \{([^}]*)\} from 'lucide-vue-next'/.exec(source)
    if (lucide && /\bCheck\b/.test(lucide[1]) && !rel(file).endsWith('SourceControl.vue')) {
      bad.push(`${rel(file)} 仍从 lucide 导入 Check`)
    }
    // 菜单槽位里不许再出现 `<Check `（大写 C 开头的 lucide 组件名）。
    if (/<Check[ >/]/.test(source) && !rel(file).endsWith('SourceControl.vue')) {
      bad.push(`${rel(file)} 模板里仍渲染 <Check>`)
    }
  }
  assert.deepEqual(bad, [], `这些位置该用 IDEA 的 checked.svg 副本（IdeaCheckedIcon）：\n${bad.join('\n')}`)
})

test('每个用勾选记号的组件都真的 import 了 IdeaCheckedIcon', () => {
  const bad = []
  for (const file of vueFiles()) {
    const source = read(file)
    if (!/<IdeaCheckedIcon[ >/]/.test(source)) continue
    if (!/import \{[^}]*\bIdeaCheckedIcon\b[^}]*\} from '[^']*icons\/toolWindowIcons/.test(source)) {
      bad.push(rel(file))
    }
  }
  assert.deepEqual(bad, [], `这些文件用了 IdeaCheckedIcon 却没 import：\n${bad.join('\n')}`)
})

test('IdeaCheckedIcon 真渲染出上游那条 path（16 格，不是 lucide 的 24 格）', async () => {
  const html = await renderToString(createSSRApp({ render: () => h(IdeaCheckedIcon, { size: 13 }) }))
  assert.match(html, /viewBox="0 0 16 16"/, '勾选记号是 16 格图')
  assert.match(html, /width="13" height="13"/, ':size 透传')
  assert.ok(html.includes(IDEA_ICON_16.checked.body[0]), '画的不是上游 checked.svg 那条 path')
  // 反例：lucide 的 `Check` 是 24 格，class 里会带 `lucide`。
  assert.doesNotMatch(html, /class="lucide/, '又混进 lucide 的勾了')
})

test('checked 只有 16 格一份：尺寸档取 menu(13) / toolbar(15) 时都退回 16 格', () => {
  // 上游 `loadIconCustomVersion` 找不到 `checked@20x20.svg` 就退回 16 格（见 ideaIconData.ts），
  // 所以这里钉住"没有 20 格变体"这件事 —— 有朝一日上游加了变体，这条会红，提示去更新生成器。
  assert.ok(IDEA_ICON_16.checked, '16 格那份必须在')
  const { IDEA_ICON_20 } = require('../src/components/icons/ideaIconData.ts')
  assert.equal(IDEA_ICON_20.checked, undefined, '上游没有 checked@20x20.svg，20 格表里不该有它')
})

test('App.vue 的四处菜单勾选（主菜单/状态栏组件/查找操作）都走 expui 副本', () => {
  const app = read(join(SRC, 'App.vue'))
  assert.doesNotMatch(app, /<Check[ >/]/, 'App.vue 里不该再有 lucide 的勾')
  assert.match(app, /import \{[^}]*\bIdeaCheckedIcon\b[^}]*\} from '\.\/components\/icons\/toolWindowIcons\.ts'/)
  // 四处调用点：主菜单子项 / 主菜单行 / 状态栏组件清单 / 查找操作面板。
  const uses = [...app.matchAll(/<IdeaCheckedIcon[ >/]/g)].length
  assert.equal(uses, 4, `App.vue 该有 4 处勾选记号，实得 ${uses}`)
})
// 三方合并编辑器「接受左侧 / 接受右侧」的两颗按钮：上游是**方向箭头**，不是勾。
// `intellij.platform.ide.actions.xml:54-55` 的 `Diff.ApplyLeftSide` = `AllIcons.Diff.ArrowRight`、
// `Diff.ApplyRightSide` = `AllIcons.Diff.Arrow`（`AllIcons.java:424/427`，都是 14 格图）。
// 语义是"把左侧/右侧**搬过去**"，所以左键画右箭头、右键画左箭头 —— 画一个勾是发明形状。
test('合并编辑器的接受左/右两颗画的是上游的 diff 方向箭头，不是勾', async () => {
  const { IDEA_ICON_16 } = require('../src/components/icons/ideaIconData.ts')
  const { IdeaApplyLeftSideIcon, IdeaApplyRightSideIcon } = require('../src/components/icons/toolWindowIcons.ts')
  const left = await renderToString(createSSRApp({ render: () => h(IdeaApplyLeftSideIcon, { size: 13 }) }))
  const right = await renderToString(createSSRApp({ render: () => h(IdeaApplyRightSideIcon, { size: 13 }) }))
  assert.ok(left.includes(IDEA_ICON_16.applyLeftSide.body[0]), '接受左侧画的不是 ArrowRight 那条 path')
  assert.ok(right.includes(IDEA_ICON_16.applyRightSide.body[0]), '接受右侧画的不是 Arrow 那条 path')
  assert.match(left, /viewBox="0 0 14 14"/, 'diff 箭头是 14 格图')
  // 与菜单勾选记号是**两张不同的图**（防有人拿勾去顶）。
  assert.notEqual(IDEA_ICON_16.applyLeftSide.body[0], IDEA_ICON_16.checked.body[0])
  const source = read(join(SRC, 'components', 'MergeEditor.vue'))
  assert.doesNotMatch(source, /<Check[ >/]/, 'MergeEditor 里不该再有 lucide 的勾')
  assert.match(source, /<IdeaApplyLeftSideIcon[^>]*\/>\{\{ ACCEPT_LEFT_TEXT \}\}/, '接受左侧要用 ArrowRight 副本')
  assert.match(source, /<IdeaApplyRightSideIcon[^>]*\/>\{\{ ACCEPT_RIGHT_TEXT \}\}/, '接受右侧要用 Arrow 副本')
})
