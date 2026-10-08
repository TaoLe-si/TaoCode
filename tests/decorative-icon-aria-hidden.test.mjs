// 「带文字按钮里的装饰性图标必须对读屏隐藏」的门禁（2026-10-06 UI 对标线，第一百二十一批）。
//
// 由来：IDEA/Swing 的按钮把无障碍名放在按钮上，图标不进无障碍树；本仓的 lucide / expui
// `<svg>` 没有 role，读屏器对它的处理因引擎而异 —— 只靠"没有 role 就当没有"是**碰运气**。
// 显式补 `aria-hidden="true"` 才与"按钮的文字就是它的名字、图标只是装饰"这条口径一致。
//
// 本批把本线名下（`src/components/**`，除四个大组件 lane 独占的文件与 `App.vue`）扫描到的
// 装饰性图标全部补齐 —— 93 处、43 个文件。**按钮已带文字**才补：整颗按钮只有图标的属于
// 纯图标钮，那要的是 `aria-label`/`title`（`tests/ui-icons.test.mjs` 管），不能反过来藏起来。
//
// 判据（结构式，AST 扫模板，不看正则，免得属性值里的 `>` 提前截断）：
//   1. 扫描范围内，"子树里有真字母/数字/汉字"的 `<button>` 里，每一个图标元素
//      （`svg` / `component` / `<img>` / 从 lucide 或本仓 icons 导入的组件）都要带 `aria-hidden`；
//   2. 开关/选中态的图标（`IdeaCheckedIcon` / `Check` / `Loader2` / `Circle` …）**不在此列** ——
//      它们表达的是状态，归属 `tests/toggle-aria-state.test.mjs` 那一族，藏掉反而丢信息。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseDom, NodeTypes } from '@vue/compiler-dom'

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
/** 大组件 lane 独占 + App.vue（只有 6 行余量，本线禁改）—— 扫描范围排除它们。 */
const EXCLUDED = new Map([
  ['CodeEditor.vue', '大组件 lane 独占'],
  ['DebugPanel.vue', '大组件 lane 独占'],
  ['SourceControl.vue', '大组件 lane 独占'],
  ['DiffView.vue', '大组件 lane 独占'],
  ['EditorFindBar.vue', '大组件 lane 独占'],
  ['App.vue', '本线禁改（行数余量只剩 6 行），已知 33 处未补'],
  ['FileTree.vue', '另一 lane 正在并行编辑，避免大面积冲突，本批未动（已知 10 处）'],
])
/** 表达状态的图标：隐藏它们会丢掉"选中/运行中"这层信息，不归本判据管。 */
const STATE_ICONS = new Set(['IdeaCheckedIcon', 'Check', 'CheckCheck', 'Loader2', 'Circle'])

function vueFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) vueFiles(p, out)
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}
function walk(node, visit) { visit(node); for (const child of node.children ?? []) walk(child, visit) }
const hasRealWord = text => /[\p{L}\p{N}]/u.test(text)
function attrOf(node, name) {
  return node.props?.find(p =>
    (p.type === NodeTypes.ATTRIBUTE && p.name === name) ||
    (p.type === NodeTypes.DIRECTIVE && p.arg?.content === name))
}
function importNames(file, re) {
  const src = readFileSync(file, 'utf8')
  const names = new Set()
  for (const m of src.matchAll(re)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim()
      if (name && /^[A-Z]/.test(name)) names.add(name)
    }
  }
  return names
}

const ALL_FILES = vueFiles(SRC)
const SCANNED = ALL_FILES.filter(f => !EXCLUDED.has(f.split(/[\\/]/).pop()))
const rel = f => f.split(String.fromCharCode(92)).join('/').replace(/^.*?\/src\//, 'src/')

test('带文字按钮里的装饰性图标都带了 aria-hidden', () => {
  const bad = []
  let buttons = 0
  for (const file of SCANNED) {
    const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
    if (!descriptor.template?.content) continue
    const lucide = importNames(file, /import\s*\{([^}]*)\}\s*from\s*['"]lucide-vue-next['"]/g)
    const idea = importNames(file, /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*icons\/[^'"]*['"]/g)
    const ast = parseDom(descriptor.template.content)
    const offset = descriptor.template.loc.start.line - 1
    walk(ast, node => {
      if (node.type !== NodeTypes.ELEMENT || node.tag !== 'button') return
      let text = ''
      walk(node, n => {
        if (n.type === NodeTypes.TEXT) text += n.content
        else if (n.type === NodeTypes.INTERPOLATION) text += n.content.content
      })
      if (!hasRealWord(text)) return   // 纯图标钮不归这里（要的是 aria-label）
      buttons += 1
      const visitIcon = n => {
        if (n.type === NodeTypes.ELEMENT) {
          const isIcon = n.tag === 'svg' || n.tag === 'component' || n.tag === 'img'
            || lucide.has(n.tag) || idea.has(n.tag)
          if (isIcon) {
            if (!STATE_ICONS.has(n.tag) && !attrOf(n, 'aria-hidden')) {
              bad.push(`${rel(file)}:${n.loc.start.line + offset} <${n.tag}>`)
            }
            return
          }
        }
        for (const child of n.children ?? []) visitIcon(child)
      }
      for (const child of node.children ?? []) visitIcon(child)
    })
  }
  assert.ok(buttons >= 100, `只扫到 ${buttons} 颗带文字的按钮 —— 判据本身可能空转了`)
  assert.deepEqual(bad, [],
    `这些装饰性图标没对读屏隐藏（按钮已有文字，图标只是装饰，补 aria-hidden="true"）：\n${bad.join('\n')}`)
})

test('排除表里的文件都还在（不许拿一个不存在的文件名当挡箭牌）', () => {
  const names = new Set(ALL_FILES.map(f => f.split(/[\\/]/).pop()))
  for (const [name, why] of EXCLUDED) {
    assert.ok(names.has(name), `排除表里的 ${name} 不存在了`)
    assert.ok(why.trim().length >= 5, `${name} 的排除理由太短`)
  }
  // 扫描范围必须真的覆盖到本线的组件目录，而不是被排除表吃空。
  assert.ok(SCANNED.length >= 100, `扫描范围只剩 ${SCANNED.length} 个文件，排除表把它吃空了`)
})
