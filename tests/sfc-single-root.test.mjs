import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseDom, NodeTypes } from '@vue/compiler-dom'

/**
 * 「多根 SFC + 运行时指令」这条坑的门禁。
 *
 * Vue 3 的 `v-show` 和 `ref` 都要求组件是**单根**的。多根（fragment）时 `v-show` 挂到
 * fragment 的锚点注释上，`display: none` 根本打不出去 —— 开发模式只在 warning 里说一声，
 * 编译期一声不响，页面上则是「显隐控制彻底失效」。
 *
 * 2026-10-02 实测：`CodeEditor.vue` 原本是 `<div class="code-editor">` 加两个
 * `<Teleport to="body">` 并列（3 个根），App.vue 用 `v-show` 控制每个打开文件的显隐，
 * 于是每个文件都渲染出来、在 .editor-stage（display: flex）里横向挤成一排 ——
 * 7 个标签就变成 7 个「分屏窗口」。见 docs/ui-parity-checklist.md 第八十六批。
 *
 * 门禁只查**实际被 `v-show` / `ref` 用到的**组件。多根本身在 Vue 3 里合法（不写这两者就没事），
 * 全仓一刀切要求单根会误伤 8 个本来就没事的组件。
 */

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function vueFiles(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) vueFiles(p, out)
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}

function walk(node, visit) {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

/** 组件名（`Foo.Bar` 取 `Bar`）→ 模板里元素根的个数。null = 本仓没有同名 SFC。 */
const ROOT_COUNT = new Map()
for (const file of vueFiles()) {
  const { descriptor, errors } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
  assert.equal(errors.length, 0, `${file} 解析失败：${errors[0]?.message}`)
  if (!descriptor.template) continue
  const ast = parseDom(descriptor.template.content)
  ROOT_COUNT.set(file.split(/[\\/]/).pop().replace(/\.vue$/, ''), ast.children.filter(c => c.type === NodeTypes.ELEMENT).length)
}

/** 全仓所有「用了 v-show / ref」的组件标签，连同用它的文件。 */
function usages(directiveOf) {
  const found = []
  for (const file of vueFiles()) {
    const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
    if (!descriptor.template) continue
    walk(parseDom(descriptor.template.content), node => {
      if (node.type !== NodeTypes.ELEMENT) return
      const tag = typeof node.tag === 'string' ? node.tag : ''
      const name = tag.split('.').pop()
      // 只管本仓自己的组件；HTML 原生标签和 lucide 图标（小写或 PascalCase 但不在表里）跳过
      if (!/^[A-Z]/.test(name) || !ROOT_COUNT.has(name)) return
      if (directiveOf(node)) found.push({ file: file.split(/[\\/]/).pop(), tag, name, roots: ROOT_COUNT.get(name) })
    })
  }
  return found
}

const hasVShow = node => (node.props ?? []).some(p => p.type === NodeTypes.DIRECTIVE && p.name === 'show')
const hasRef = node => (node.props ?? []).some(p =>
  (p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && p.arg?.content === 'ref') ||
  (p.type === NodeTypes.ATTRIBUTE && p.name === 'ref'))

test('被 v-show 用到的组件都是单根：多根时 v-show 静默失效', () => {
  const offenders = usages(hasVShow).filter(u => u.roots !== 1)
  assert.deepEqual(offenders, [],
    `多根组件被 v-show 控制，显隐会彻底失效（v-show 挂到 fragment 锚点注释上）：\n` +
    offenders.map(u => `  ${u.name}（${u.roots} 个根）用在 ${u.file} 的 <${u.tag}>`).join('\n'))
})

test('被 ref 用到的组件都是单根：多根时 ref 拿到的是 fragment 而不是元素', () => {
  const offenders = usages(hasRef).filter(u => u.roots !== 1)
  assert.deepEqual(offenders, [],
    `多根组件被 ref 取引用，拿到的是 fragment 锚点而不是元素：\n` +
    offenders.map(u => `  ${u.name}（${u.roots} 个根）用在 ${u.file} 的 <${u.tag}>`).join('\n'))
})

test('CodeEditor 是单根：它的多根曾经让每个打开的文件都渲染出来', () => {
  assert.equal(ROOT_COUNT.get('CodeEditor'), 1,
    'CodeEditor 必须单根。App.vue 用 v-show 控制每个文件的编辑器显隐，多根 ⇒ 全部渲染 ⇒ ' +
    '在 .editor-stage 的 flex 行里挤成多个假分屏。')
})

test('收集器本身是活的：真的抓得到多根组件', () => {
  // 门禁要是恒空就等于没有门禁（第八十五批刚踩过一次）。这里断言表里确有若干多根组件，
  // 且它们确实不是「误判」—— 多根只在被 v-show / ref 用到时才有害。
  const multi = [...ROOT_COUNT].filter(([, n]) => n !== 1).map(([name]) => name)
  assert.ok(multi.length > 0, '样本为空，判据没在干活')
  // App.vue 本身就是多根（根组件允许），但不该被别的文件 v-show/ref
  const touched = new Set(usages(hasVShow).concat(usages(hasRef)).map(u => u.name))
  for (const name of multi) {
    assert.equal(touched.has(name), false, `${name} 仍是多根却被 v-show/ref 用到了`)
  }
})
