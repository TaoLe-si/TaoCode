// 对话框按钮顺序 = 上游 `DialogWrapper` 的数组序。
//
// 上游 `SettingsDialog.createActions()`（`platform/platform-impl/src/com/intellij/openapi/options/newEditor/SettingsDialog.java:203-218`）：
//   `actions.add(getOKAction()); actions.add(getCancelAction());`
//   `… if (apply != null && isApplyButtonNeeded) actions.add(new ApplyActionWrapper(apply));`
//   `… if (reset != null && isResetButtonNeeded) actions.add(reset);`
//   `… if (getHelpId() != null) actions.add(getHelpAction());`
// 摆法是 `createButtonsPanel`（`DialogWrapper.java:856-873`）的 `BoxLayout(BoxLayout.X_AXIS)` —— 按数组序
// **从左到右**摆，整组由左边那个 `Box.createHorizontalGlue()`（`:807`）顶到右沿。所以视觉顺序就是
// 数组顺序：**确定 · 取消 · 应用 · 重置 · 帮助**（Mac 上由 `sortActionsOnMac` 另排，见下）。
//
// 本仓的 `.footer-actions` 是 `justify-content: flex-end` 的 flex 行，同样是"从左到右 = 源码顺序"。
// 这条门禁钉住设置对话框底部那三颗的顺序 —— 原先写反了（应用 / 取消 / 确定），而它跟上游、
// 跟本档自己的记录（`docs/ui-parity-checklist.md:136` 的「底部 `确定 / 取消 / 应用(A)` 三键」）都不符。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseSfc, compileTemplate } from '@vue/compiler-sfc'
import { parse, parse as parseDom, NodeTypes } from '@vue/compiler-dom'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ts from 'typescript'

const require = createRequire(import.meta.url)

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
function walk(node, visit) { visit(node); for (const child of node.children ?? []) walk(child, visit) }
const staticClassOf = node => {
  for (const p of node.props ?? []) if (p.type === NodeTypes.ATTRIBUTE && p.name === 'class') return p.value?.content ?? ''
  return ''
}
const textOf = node => (node.children ?? []).filter(c => c.type === NodeTypes.TEXT).map(c => c.content).join('').trim()

function classIs(node, name) {
  return node.type === 1 && node.props.some(p => p.type === 6 && p.name === 'class' && p.value?.content.split(' ').includes(name))
}
function find(node, predicate) {
  if (predicate(node)) return node
  for (const child of node.children ?? []) { const match = find(child, predicate); if (match) return match }
}

/** 只渲染设置对话框的 footer 片段（整页要树/页组件，且链上有循环 import，SSR 代价大且与本判据无关）。 */
async function renderFooterSlice(file, className) {
  const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
  const node = find(parse(descriptor.template.content), n => classIs(n, className))
  assert.ok(node, `没找到 .${className}（判据本身失效了）`)
  const result = compileTemplate({ source: node.loc.source, filename: file, id: 'footer-order', compilerOptions: { expressionPlugins: ['typescript'] } })
  assert.deepEqual(result.errors, [])
  const js = ts.transpileModule(result.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  new Function('require', 'exports', js)(require, exports)
  const app = createSSRApp({ setup: () => ({ busy: false, dirty: false }), render: exports.render })
  app.config.warnHandler = () => {}
  return renderToString(app)
}

/** 从一段 HTML 里按出现顺序取出按钮文案。 */
function buttonTexts(html) {
  return [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)]
    .map(match => match[1].replace(/<[^>]*>/g, '').trim())
}

test('设置对话框底部三键的顺序照上游：确定 · 取消 · 应用(A)', async () => {
  const html = await renderFooterSlice('src/components/SettingsDialog.vue', 'footer-actions')
  assert.deepEqual(buttonTexts(html), ['确定', '取消', '应用(A)'],
    '顺序必须是 确定 / 取消 / 应用(A)（上游 createActions 的数组序；Mac 上另有 sortActionsOnMac 重排）')
  // 主按钮（`DEFAULT_ACTION` 那一颗）仍是「确定」—— 顺序变了不等于主次变了。
  assert.match(html, /class="primary-button"[^>]*>确定</, '「确定」要还是主按钮')
  assert.doesNotMatch(html, /primary-button"[^>]*>应用/, '「应用(A)」不该变成主按钮')
})

test('上游那三行的出处是真的（防止有人照旧印象改回去）', () => {
  const REF = process.env.TAOCODE_REF_TREE || 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
  const source = readFileSync(`${REF}/platform/platform-impl/src/com/intellij/openapi/options/newEditor/SettingsDialog.java`, 'utf8')
  const body = source.slice(source.indexOf('protected Action @NotNull [] createActions()'))
  const order = [...body.slice(0, 700).matchAll(/actions\.add\((.*?)\);\s*$/gm)].map(m => m[1].trim())
  assert.deepEqual(order, ['getOKAction()', 'getCancelAction()', 'new ApplyActionWrapper(apply)', 'reset', 'getHelpAction()'],
    'createActions 的追加序变了 —— 本仓的按钮顺序要跟着改')
  // 摆法：BoxLayout.X_AXIS 按数组序左→右。
  const wrapper = readFileSync(`${REF}/platform/platform-api/src/com/intellij/openapi/ui/DialogWrapper.java`, 'utf8')
  assert.match(wrapper, /buttonsPanel\.setLayout\(new BoxLayout\(buttonsPanel, BoxLayout\.X_AXIS\)\)/,
    'layoutButtonsPanel 不再是 X_AXIS 的 BoxLayout —— "数组序 = 视觉序"这条前提不成立了')
})
// --- 结构式扫全仓：主按钮不许排在「取消」后面 -------------------------------------------------
//
// 上游三处独立证据都指向同一条顺序（Windows/Linux 上）：
//   1. `DialogWrapper.createActions()`（`DialogWrapper.java:1234-1238`）返回 `{getOKAction(), getCancelAction()}`
//      —— OK 在前；`layoutButtonsPanel`（`:862-873`）用 `BoxLayout.X_AXIS` 按数组序左→右摆，
//      整组由左边的 `Box.createHorizontalGlue()`（`:807`）顶到右沿 ⇒ 视觉上 OK 在左、Cancel 在右。
//   2. `MessageDialogBuilder.okCancel`（`MessageDialogBuilder.kt:217-220`）的 `options = arrayOf(yesText, noText)`
//      —— 主选项在前；`yesNoCancel`（`:157`）同理 `[yes, no, cancel]`。
//   3. `RefactoringDialog.createActions()`（`RefactoringDialog.java:225-232`）`[refactor, preview?, cancel, help?]`
//      —— 重构在取消之前。
// Mac 上由 `DialogWrapper.sortActionsOnMac`（`:710-713`，按 `MAC_ACTION_ORDER`：Cancel = -10、OK = 100）
// 重排成 Cancel 在左，所以这条只适用于 Windows/Linux —— 本仓是 WebView2 的 Windows 宿主。
//
// 例外表按 (文件, 主按钮文案) 精确匹配，每条必须写清为什么该反着排。
//
// 现在是**空的**：判据按「父容器内相邻两颗按钮 + 后一颗是 `.primary-button`」两道限定，
// 已经不会误伤工具条/菜单行/跨对话框那些形状（试过把全仓扫一遍，零假阳性）。
// 真出现"该反着排"的对话框时再往里加，并且下面那条会盯住它不许过期。
const ORDER_EXEMPTIONS = [
]

test('全仓：主按钮不许排在「取消」后面（上游 OK/Cancel 的数组序）', () => {
  const bad = []
  for (const file of vueFiles()) {
    const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
    if (!descriptor.template) continue
    const offset = descriptor.template.loc.start.line - 1
    let ast
    try { ast = parseDom(descriptor.template.content) } catch { continue }
    // 按**父容器**分组：同一个按钮行里的相邻两颗才是一对；跨对话框的按钮不能比
    // （整棵模板里平铺所有按钮时，上一框的「取消」会跟下一框的主按钮误配成一对）。
    walk(ast, container => {
      if (container.type !== NodeTypes.ELEMENT && container.type !== NodeTypes.ROOT && container.type !== NodeTypes.FRAGMENT) return
      const buttons = (container.children ?? []).filter(node => node.type === NodeTypes.ELEMENT && node.tag === 'button')
      for (let i = 0; i < buttons.length - 1; i += 1) {
        const cancel = textOf(buttons[i])
        const primary = textOf(buttons[i + 1])
        if (!cancel.startsWith('取消') || !primary) continue
        if (primary.startsWith('取消') || primary.startsWith('关闭')) continue
        if (ORDER_EXEMPTIONS.some(e => e.file === rel(file) && e.primary === primary)) continue
        // 只有当后面那颗确实是"主按钮"（primary-button 类）才算：纯次级按钮对（两棵 subtle）也可能是
        // "取消 / 放弃"这种同层选择，按上游 `yesNoCancel` 的 [yes, no, cancel] 反而是对的。
        const nextClass = staticClassOf(buttons[i + 1])
        if (!/\bprimary-button\b/.test(nextClass)) continue
        bad.push(`${rel(file)}:${buttons[i].loc.start.line + offset} 取消 在 ${primary} 之前`)
      }
    })
  }
  assert.deepEqual(bad, [],
    '这些对话框把「取消」排在了主按钮前面（上游 createActions = [OK, Cancel]，左→右）：\n' + bad.join('\n'))
})

test('例外表不许养着空条目', () => {
  for (const { file, primary, why } of ORDER_EXEMPTIONS) {
    assert.ok((why ?? '').trim().length >= 8, `${file} 的例外 ${primary} 没写理由`)
    const source = readFileSync(file, 'utf8')
    assert.ok(source.includes(primary), `例外表里的 ${file} 已经找不到「${primary}」了，删掉这一条`)
  }
})

test('所有对话框的主按钮都渲染在取消之前（真渲染逐框核）', async () => {
  // 抽查几个代表性对话框（其余由上面那条结构式判据覆盖）：OK 在前、主按钮是 primary-button。
  const cases = [
    ['src/components/BookmarkDescriptionDialog.vue', 'dialog-actions', ['确定', '取消']],
    ['src/components/ExportToHtmlDialog.vue', 'export-actions', ['保存', '取消']],
    ['src/components/TestResultsExportDialog.vue', 'tre-actions', ['保存', '取消']],
    ['src/components/RefactorSignatureDialog.vue', 'dialog-actions', ['重构', '取消']],
    ['src/components/FileNestingSettings.vue', 'dialog-actions', ['确定', '取消']],
  ]
  for (const [file, className, expected] of cases) {
    const html = await renderFooterSlice(file, className)
    assert.deepEqual(buttonTexts(html), expected, `${file} 的按钮序不对`)
  }
})
