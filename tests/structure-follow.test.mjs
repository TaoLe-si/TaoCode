// 结构视图补上的三条：编辑光标 ↔ 树选中的互相跟随、按可见性排序、折叠态按文件保留。
// 上游坐标见 src/structureFollow.ts 与 src/outlineView.ts 的文件头。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { arrange, caretSymbolInTree, outlineKey, treeOf } from '../src/outlineView.ts'
import {
  ACCESS_LEVEL, COLLAPSED_MEMORY_LIMIT, collapsedMemoryPaths, rememberCollapsed, restoredCollapsed,
  shouldRevealInEditor, visibilityAccessLevel,
} from '../src/structureFollow.ts'

const sym = (name, kind, startLine, endLine, startChar = 0, detail = '') => ({
  name, kind, detail, startLine, startChar, endLine, endChar: startChar + name.length,
})

const members = [
  sym('Class', 5, 0, 20, 0, 'public class Class'),
  sym('priv', 6, 2, 3, 4, 'private void priv()'),
  sym('pub', 6, 5, 6, 4, 'public void pub()'),
  sym('prot', 6, 8, 9, 4, 'protected void prot()'),
  sym('pkg', 6, 11, 12, 4, 'package-private void pkg()'),
  sym('unknown', 6, 14, 15, 4, 'void unknown()'),
]
const tree = treeOf(members)
const names = list => list.map(entry => entry.symbol.name)

test('可见性档位照 PsiUtil 的四档判，判不出的是 unknown', () => {
  assert.equal(visibilityAccessLevel('public static void main()'), ACCESS_LEVEL.public)
  assert.equal(visibilityAccessLevel('protected int counter'), ACCESS_LEVEL.protected)
  assert.equal(visibilityAccessLevel('package-private void pkg()'), ACCESS_LEVEL.packageLocal)
  assert.equal(visibilityAccessLevel('private final String x'), ACCESS_LEVEL.private)
  assert.equal(visibilityAccessLevel('void nothing()'), ACCESS_LEVEL.unknown)
  // private 短路优先（PsiUtil.java:623-634 的判定次序：先 private，再包级，再 protected）。
  assert.equal(visibilityAccessLevel('public private'), ACCESS_LEVEL.private)
  // internal（Kotlin/Swift）在本仓落到包级档，理由写在模块头。
  assert.equal(visibilityAccessLevel('internal fun helper()'), ACCESS_LEVEL.packageLocal)
})

test('按可见性排序：公开在前、判不出的排最后，同级保持原序', () => {
  const rows = arrange(tree, { sort: false, flat: false, group: false, visibility: true, filter: '' })
  assert.deepEqual(names(rows), ['Class', 'pub', 'prot', 'pkg', 'priv', 'unknown'])
})

test('可见性与名称同时开时，名称就是同级的次序', () => {
  const tie = [
    sym('C', 5, 0, 9, 0, 'public class C'),
    sym('bbb', 6, 1, 2, 2, 'public void bbb()'),
    sym('aaa', 6, 3, 4, 2, 'public void aaa()'),
    sym('zzz', 6, 6, 7, 2, 'private void zzz()'),
  ]
  const rows = arrange(treeOf(tie), { sort: true, flat: false, group: false, visibility: true, filter: '' })
  assert.deepEqual(names(rows), ['C', 'aaa', 'bbb', 'zzz'])
})

test('不开可见性时顺序一个字都不变（不影响既有断言）', () => {
  assert.deepEqual(names(arrange(tree, { sort: false, flat: false, group: false, filter: '' })),
    ['Class', 'priv', 'pub', 'prot', 'pkg', 'unknown'])
})

test('光标命中最深的符号，祖先键一并给出以便展开', () => {
  const nested = [
    sym('Outer', 5, 0, 30, 0, 'class Outer'),
    sym('Inner', 5, 2, 25, 2, 'class Inner'),
    sym('work', 6, 10, 14, 4, 'void work()'),
  ]
  const match = caretSymbolInTree(treeOf(nested), 12, 6)
  assert.ok(match)
  assert.equal(match.key, outlineKey(nested[2]))
  assert.deepEqual(match.ancestors, [outlineKey(nested[0]), outlineKey(nested[1])])
  assert.equal(match.lineOnly, false)
})

test('光标停在声明行的关键字/缩进上仍命中那个符号', () => {
  // members[2] = pub：startLine 5 / startChar 4（声明名那一列），光标在第 5 行第 0 列。
  const match = caretSymbolInTree(tree, 5, 0)
  assert.ok(match, '第 5 行的 pub 要能被找到')
  assert.equal(match.key, outlineKey(members[2]))
  assert.equal(match.lineOnly, false)
})

test('同行越过符号终点时不认它，退化成按行才认（不空手）', () => {
  const leaf = [sym('only', 6, 3, 3, 4, 'void only()')]
  // 终点在第 3 行第 8 列，光标在第 3 行第 20 列：按列判定不命中，按行判定兜底。
  assert.equal(caretSymbolInTree(treeOf(leaf), 3, 20).lineOnly, true)
  assert.equal(caretSymbolInTree(treeOf(leaf), 3, 6).lineOnly, false)
})

test('光标不在任何符号里就什么都不选', () => {
  assert.equal(caretSymbolInTree(tree, 40, 0), null)
})

test('跟随到源码关掉时，选中同一行不再发跳转', () => {
  assert.equal(shouldRevealInEditor(true, 'a:1:0:2:0', ''), true)
  assert.equal(shouldRevealInEditor(true, 'a:1:0:2:0', 'a:1:0:2:0'), false, '重复选中不跳')
  assert.equal(shouldRevealInEditor(false, 'a:1:0:2:0', ''), false, '开关关掉时不跳（双击才跳）')
  assert.equal(shouldRevealInEditor(true, '', 'x'), false, '没有选中就不跳')
})

test('面板真的把两个跟随开关和可见性排序接上了（不是死代码）', () => {
  const panel = readFileSync('src/components/OutlinePanel.vue', 'utf8')
  // 钉**挂点**（事件绑定 / 调用表达式），不是 import 的符号名。
  assert.match(panel, /@click="autoscrollFromSource = !autoscrollFromSource"/, '从源码跟随的开关可切')
  assert.match(panel, /@click="autoscrollToSource = !autoscrollToSource"/, '到源码跟随的开关可切')
  assert.match(panel, /@click="sortByVisibility = !sortByVisibility"/, '可见性排序的开关可切')
  assert.match(panel, /visibility: sortByVisibility\.value/, '排序开关进了 arrange 的入参')
  assert.match(panel, /caretSymbolInTree\(tree\.value, props\.source\.line/, '光标→选中的判定接在面板上')
  assert.match(panel, /shouldRevealInEditor\(autoscrollToSource\.value/, '选中→跳转的判定接在面板上')
  assert.match(panel, /scrollRowIntoView\(match\.key\)/, '跟随时要把那一行滚进视野')
  // 双击仍要跳源码：继承成员行接出来之后统一走 `rowJump`（继承行跳成员真身，
  // 普通行转 `selectRow(entry, force)` —— 下面那条把这条委派也钉住，语义没降级）。
  assert.match(panel, /@dblclick="rowJump\(entry, true\)"/, '关掉跟随时双击仍跳源码')
  assert.match(panel, /function rowJump\(entry: OutlineDisplayRow, force = false\)[\s\S]{0,160}selectRow\(entry, force\)/, '普通行的双击/回车委派回 selectRow(entry, force)')
})

// 14b 的接线请求 W1（\u300c跟随编辑器光标\u300d那一半的入参）已经落地：窗格把光标位置喂给了面板。
test('跟随光标的挂点真的在：窗格传 :source，面板没有它就不画那一格', () => {
  const view = readFileSync('src/components/ToolWindowView.vue', 'utf8')
  assert.match(view, /<OutlinePanel[^>]*:source="ctx\.todoSource"/, '面板拿到的是活动文件的光标（与 TodoPanel 同一份）')
  const panel = readFileSync('src/components/OutlinePanel.vue', 'utf8')
  assert.match(panel, /v-if="source"/, '没有光标数据时整格不渲染（不画点了没反应的开关）')
  assert.match(panel, /props\.source\.line - 1/, '编辑器口径（1 基）换成符号区间口径（0 基）')
})

// ---------------------------------------------------------------------------
// 折叠态的「按编辑器保存 / 取回」（上游 `StructureViewComponent.java:398-407` 存、
// `:415-428` 取；调用点 `StructureViewWrapperImpl.kt:478`/`:552`）。
// 上一版面板在换文件时整张清空折叠表，于是「A 收到只剩顶层 → 切去 B → 切回 A」之后折叠没了。
// ---------------------------------------------------------------------------
test('存一份、切回来取到同一份，并且是一次性消费（:426 的 putUserData(…, null)）', () => {
  assert.equal(collapsedMemoryPaths().includes('pv5/a.ts'), false, '起点：这张表里没有本判据的路径')
  rememberCollapsed('pv5/a.ts', new Set(['Outer:0:0:30:0']))
  assert.deepEqual([...restoredCollapsed('pv5/a.ts')], ['Outer:0:0:30:0'])
  assert.deepEqual([...restoredCollapsed('pv5/a.ts')], [], '第二次取就是空表（= 全展开），同上游那份被清空')
})

test('两条不同根的折叠记录互不污染（本仓按文件路径分桶，上游按 FileEditor 挂 user data）', () => {
  // 上游没有「路径」这一维（状态挂在编辑器对象上），本仓只有一个面板实例 ⇒ 用路径当桶（模块头记着这条不等价）。
  // 这一条判的就是桶真的存在：A 与 B 有**逐字相同**的折叠键（键 = 名字 + 位置，见 outlineKey），
  // 共用一张表的话取 B 会把 A 的那份也带出来。
  const shared = outlineKey(sym('Shared', 5, 0, 20, 0, 'class Shared'))
  rememberCollapsed('pv5/a.ts', new Set([shared]))
  rememberCollapsed('pv5/b.ts', new Set())
  assert.deepEqual([...restoredCollapsed('pv5/b.ts')], [], 'B 自己存的是空表 ⇒ 取回空表，不能被 A 的那一份串进来')
  assert.deepEqual([...restoredCollapsed('pv5/a.ts')], [shared], 'A 的那一份还在 A 名下')
})

test('存进去的是副本：之后原集合再被改动也不影响已存的那份', () => {
  const live = new Set(['X:0:0:5:0'])
  rememberCollapsed('pv5/copy.ts', live)
  live.add('Y:6:0:9:0'); live.delete('X:0:0:5:0')
  assert.deepEqual([...restoredCollapsed('pv5/copy.ts')], ['X:0:0:5:0'], '存的那一刻就该定格')
})

test('没有路径就不写记录（上游没有 FileEditor 时 storeState 直接返回，:403）', () => {
  rememberCollapsed('', new Set(['anything:0:0:1:0']))
  assert.equal(collapsedMemoryPaths().includes(''), false)
})

test('超过上限按先到先丢（本仓那份不随编辑器销毁，模块头给的上界）', () => {
  const paths = Array.from({ length: COLLAPSED_MEMORY_LIMIT + 3 }, (_, i) => `pv5/lru-${i}.ts`)
  for (const path of paths) rememberCollapsed(path, new Set([`${path}:0:0:1:0`]))
  const kept = collapsedMemoryPaths().filter(path => path.startsWith('pv5/lru-'))
  assert.equal(kept.length, COLLAPSED_MEMORY_LIMIT, `只留 ${COLLAPSED_MEMORY_LIMIT} 份，实测留了 ${kept.length}`)
  assert.equal(kept.includes(paths[0]), false, '最先进去的那一份被挤掉')
  assert.equal(kept.includes(paths.at(-1)), true, '最后进去的那一份留着')
  // 清场：把本判据写进去的都取走，别把后面那条面板判据的初始状态弄脏。
  for (const path of paths) restoredCollapsed(path)
  assert.equal(collapsedMemoryPaths().filter(path => path.startsWith('pv5/lru-')).length, 0)
})

/** `loadSetup` 里没有组件实例，Vue 会给钩子/警告打 dev 输出 —— 与本判据无关，消音。 */
function quiet(fn) {
  const error = console.error
  const warning = console.warn
  console.error = () => {}
  console.warn = () => {}
  try { return fn() } finally { console.error = error; console.warn = warning }
}

// 这一条是**跑组件真代码**的：拿 `src/components/OutlinePanel.vue` 那份 setup，喂 reactive 的 props，
// 换 path 后等 watch 的 pre-flush 跑完，再读面板自己的 `rows`。把上一版的整张清空改回来 ⇒ 这条变红。
test('面板换文件时存/取折叠态：A 收起的分支切出去再切回来还是收着', async () => {
  const { reactive, nextTick } = await import('vue')
  const { loadSetup } = await import('./vue-sfc-loader.mjs')
  const outer = sym('Outer', 5, 0, 30, 0, 'class Outer')
  const inner = sym('work', 6, 4, 6, 4, 'void work()')
  const other = sym('Other', 5, 0, 12, 0, 'class Other')
  const props = reactive({ path: 'pv5/A.java', symbols: [outer, inner], available: true })
  const { bindings } = quiet(() => loadSetup('src/components/OutlinePanel.vue', props))
  const visible = () => bindings.rows.value.map(entry => entry.symbol.name)
  const keyOf = symbol => outlineKey(symbol)

  assert.deepEqual(visible(), ['Outer', 'work'], '起点：全展开')
  bindings.toggleCollapse(keyOf(outer))
  assert.deepEqual(visible(), ['Outer'], 'A 里把 Outer 收起来')

  props.path = 'pv5/B.java'; props.symbols = [other]
  await nextTick()
  assert.deepEqual(visible(), ['Other'], 'B 第一次出现 ⇒ 没有存档就是全展开（上游 :418-421 那一支）')

  props.path = 'pv5/A.java'; props.symbols = [outer, inner]
  await nextTick()
  assert.deepEqual(visible(), ['Outer'], '切回 A ⇒ Outer 仍是收着的（这一条在整张清空的版本里必红）')
  // 一次性消费之后再切走/切回：离开 A 时又把当前这张存了回去，所以行为保持。
  props.path = 'pv5/B.java'; props.symbols = [other]
  await nextTick()
  props.path = 'pv5/A.java'; props.symbols = [outer, inner]
  await nextTick()
  assert.deepEqual(visible(), ['Outer'], '第二次往返仍保留（切走时重新 storeState）')
})

test('面板那条路真的接上了 store/restore，不是只 import 了符号', () => {
  const panel = readFileSync('src/components/OutlinePanel.vue', 'utf8')
  assert.match(panel, /if \(previous\) rememberCollapsed\(previous, collapsed\.value\)/,
    '换文件时要把上一张折叠表存到离开的那个文件名下')
  assert.match(panel, /collapsed\.value = next \? new Set\(restoredCollapsed\(next\)\) : new Set<string>\(\)/,
    '取回必须走 restoredCollapsed（一次性消费），空路径时退回空表')
  assert.equal(/collapsed\.value = new Set\(\); selectedKey\.value = ''/.test(panel), false,
    '不许再留「换文件就整张清空」那一行')
  // 窗格那边是 `v-else-if`：切走工具窗口会把组件卸掉（上游那份挂在编辑器上，
  // StructureViewComponent.java:257-260 在 dispose 里 storeState、:332 建树时 restoreState）。
  assert.match(panel, /const collapsed = ref\(new Set\(restoredCollapsed\(props\.path\)\)\)/,
    '装载时就要取回那一份，不然换走工具窗口再换回来折叠态没了')
  assert.match(panel, /onBeforeUnmount\(\(\) => \{ if \(props\.path\) rememberCollapsed\(props\.path, collapsed\.value\) \}\)/,
    '卸载时要把这一份存回去')
})

// 装载/卸载那一趟（窗格用的是 `v-else-if="view === 'outline'"`，`src/components/ToolWindowView.vue:196`
// ⇒ 切走工具窗口 = 组件销毁、切回来 = 重新 setup）上面那两条断言钉的是**挂点**，不是 import 的符号名。
// 为什么这里不跑组件：夹具（`tests/vue-sfc-loader.mjs`）把 `src/*.ts` 转成 CommonJS 自己求值，
// 与判据这边 `import`（ESM）拿到的是**两个模块实例**，那份 Map 不共享 ——
// 上面「换文件存/取」那条能跑，是因为整趟存取都发生在面板自己的那一份实例里。
