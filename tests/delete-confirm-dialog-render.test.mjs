// `DeleteConfirmDialog.vue` 的真渲染判据（删除确认，IDEA `DeleteHandler` / Safe Delete）。
//
// 这一批把它从 App.vue 的模板里整块搬出来（App.vue 贴着机检行数上限）。搬出去最容易出的事是
// **接线断掉**：宿主忘了把某个状态包成 getter（`setup` 顶层之外的普通对象不会自动解包 ref）、
// 或者按钮的处理器指错 —— 两者都能编过、都能渲染，只是"点了没反应"。
//
// 上游形状（逐条核过）：
//   · 标题 —— `universal.file.chooser.action.delete.confirm` 的 `Delete "X"?`；
//     目录那一支多后半句 `and all of its contents?`；
//   · 按钮 —— `DeleteHandler.java:169-171` 的 `Messages.showOkCancelDialog(project, warningMessage,
//     IdeBundle.message("title.delete"), ApplicationBundle.message("button.delete"),
//     CommonBundle.getCancelButtonText(), Messages.getQuestionIcon())`
//     ⇒ 主按钮「删除 / 移到回收站」在前、「取消」在后（`MessageDialogBuilder.okCancel` 的 options 序）；
//   · 引用清单 —— Safe Delete 先把"还有谁引用它"摆出来（`file.usages` 的全工作区文本扫描）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, createSSRApp, h, reactive } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { loadSfc } from './vue-sfc-loader.mjs'

const { component: DeleteConfirmDialog } = loadSfc('src/components/DeleteConfirmDialog.vue')

/** 与 App.vue 的 `deleteConfirmContext` 同形：状态是 getter，动作是函数。 */
function context(over = {}) {
  const calls = []
  const state = reactive({ deleteTarget: null, deleteUsages: null, deleteUsagesError: '', deleteToBin: false, ...over })
  const ctx = {
    trapFocus: () => {},
    get deleteTarget() { return state.deleteTarget }, get deleteUsages() { return state.deleteUsages },
    get deleteUsagesError() { return state.deleteUsagesError }, get deleteToBin() { return state.deleteToBin },
    closeDelete: () => calls.push(['closeDelete']),
    openUsage: path => calls.push(['openUsage', path]),
    confirmDelete: () => calls.push(['confirmDelete']),
  }
  return { ctx, state, calls }
}
const render = ctx => renderToString(createSSRApp({ render: () => h(DeleteConfirmDialog, { ctx }) }))
function renderElements(ctx) {
  const made = []
  const renderer = createRenderer({
    createElement: tag => { const node = { tag, props: {} }; made.push(node); return node },
    createText: text => ({ text }), createComment: () => ({}),
    setText: () => {}, setElementText: () => {},
    insert: () => {}, parentNode: () => null, nextSibling: () => null,
    patchProp: (el, key, _prev, next) => { el.props[key] = next },
  })
  renderer.createApp({ render: () => h(DeleteConfirmDialog, { ctx }) }).mount({})
  return made
}
const buttonsOf = nodes => nodes.filter(node => node.tag === 'button')

test('没有待删目标时一个节点都不画', async () => {
  const html = await render(context().ctx)
  assert.doesNotMatch(html, /modal-backdrop/)
  assert.doesNotMatch(html, /删除确认/)
})

test('文件：标题问「删除 “X”？」、正文随回收站开关变，按钮 = 主按钮在前 + 取消在后', async () => {
  const file = context({ deleteTarget: { name: 'a.ts', path: 'src/a.ts', kind: 'file' }, deleteToBin: true })
  const html = await render(file.ctx)
  assert.match(html, /删除 “src\/a\.ts”/)
  assert.doesNotMatch(html, /及其全部内容/, '文件那一支没有「及其全部内容」后半句')
  assert.match(html, /移到系统回收站/, '开着回收站时正文说回收站')
  // 按钮序：主按钮（移到回收站）在前、取消在后。
  const texts = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(m => m[1].replace(/<[^>]*>/g, '').trim())
  assert.deepEqual(texts.slice(-2), ['移到回收站', '取消'], '主按钮必须在取消之前（DeleteHandler.java:169-171）')
  assert.match(html, /class="primary-button menu-danger-solid"[^>]*>移到回收站</, '主按钮是危险色那支')

  // 关掉回收站：文案变「删除」，正文改成直接删除。
  const hard = context({ deleteTarget: { name: 'a.ts', path: 'src/a.ts', kind: 'file' }, deleteToBin: false })
  const hardHtml = await render(hard.ctx)
  assert.match(hardHtml, /直接删除且无法撤销/)
  assert.match(hardHtml, />删除</)
})

test('目录：标题带「及其全部内容？」后半句', async () => {
  const { ctx } = context({ deleteTarget: { name: 'src', path: 'src', kind: 'directory' } })
  const html = await render(ctx)
  assert.match(html, /删除 “src” 及其全部内容？/)
  assert.match(html, /目录及其所有子项都会从磁盘移除/)
})

test('引用清单：三种状态各自渲染（扫描失败 / 有命中 / 扫描中 / 零命中）', async () => {
  const base = { deleteTarget: { name: 'a.ts', path: 'src/a.ts', kind: 'file' } }
  // ① 扫描中（没有结果、没有错误）
  assert.match(await render(context(base).ctx), /正在扫描引用…/)
  // ② 扫描失败
  assert.match(await render(context({ ...base, deleteUsagesError: '语言服务未就绪' }).ctx), /用法扫描失败：语言服务未就绪/)
  // ③ 零命中：要说明「这不代表没有引用」，不能让人以为干净
  const zero = context({ ...base, deleteUsages: { symbol: 'foo', scanned: 12, truncated: false, hits: [] } })
  const zeroHtml = await render(zero.ctx)
  assert.match(zeroHtml, /已扫描 12 个文件/)
  assert.match(zeroHtml, /这不代表没有引用/)
  // ④ 有命中：逐条列出（最多 12 条），并带上"文本扫描不是精确分析"的说明
  const hits = Array.from({ length: 15 }, (_, i) => ({ path: `src/f${i}.ts`, line: i + 1, column: 3, preview: `引用 ${i}` }))
  const many = context({ ...base, deleteUsages: { symbol: 'foo', scanned: 40, truncated: true, hits } })
  const manyHtml = await render(many.ctx)
  assert.match(manyHtml, /有 15 处仍然引用「foo」/)
  assert.match(manyHtml, /全工作区文本扫描/)
  assert.equal([...manyHtml.matchAll(/class="delete-usage-row"/g)].length, 12, '最多列 12 条')
  assert.match(manyHtml, /结果已截断/)
})

test('点引用行 = 关掉对话框并打开那个文件；两颗按钮各自只碰自己那一件事', () => {
  const { ctx, calls } = context({ deleteTarget: { name: 'a.ts', path: 'src/a.ts', kind: 'file' },
    deleteUsages: { symbol: 'foo', scanned: 1, truncated: false, hits: [{ path: 'src/b.ts', line: 2, column: 1, preview: '' }] } })
  const buttons = buttonsOf(renderElements(ctx))
  // 第一颗是引用行按钮，最后两颗是主按钮 / 取消。
  assert.ok(buttons.length >= 3, `按钮没都渲染出来：${buttons.length}`)
  buttons[0].props.onClick()
  buttons[buttons.length - 2].props.onClick()
  buttons[buttons.length - 1].props.onClick()
  assert.deepEqual(calls, [['openUsage', 'src/b.ts'], ['confirmDelete'], ['closeDelete']])
})