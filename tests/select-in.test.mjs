// Select In（Alt+F1 弹窗）的规则。左半是可导入的纯函数，右半是对**出厂目标表**的源码级核对。
//
// 上游依据（都读过原文）：
//  · SelectInAction.java:62-72（取目标表 → 建弹窗 → showInBestPositionFor）、:99-105（showDisabledActions=true）、
//    :171-176（isSelectable）、:184-195（numberingText）
//  · SelectInManager.java:23-27 + :54-61（按 getWeight() 升序稳定排序）、SelectInTarget.java:49-51（默认权重 0）
//  · StandardTargetWeights.java:5-16（各目标的权重常量）
//  · ActionStepBuilder.java:120-131（编号 1..9 → 0 → A…）、PopupListElementRenderer.java:363-369（编号是独立一列）
//  · MnemonicsSearch.java:25-31 + :34-46（大小写双登记；只在字母数字上命中；速度搜索有字时让路；命中即吞事件）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { filterSelectIn, moveSelectIn, planSelectIn, selectInMnemonicHit, selectInMnemonics, selectInNumber } from '../src/selectIn.ts'
import { SELECT_IN_TARGET_EP, bundledSelectInTargets } from '../src/selectInTargets.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const sideViews = read('src/editorSideViews.ts')
const popup = read('src/components/SelectInPopup.vue')
const tokens = read('src/tokens.css')

const target = (id, weight, selectable = true) => ({ id, label: id, weight, selectable })

test('编号是 1..9 → 0 → A…，不是 10、11', () => {
  assert.equal([0, 1, 8].map(selectInNumber).join(''), '129')
  assert.equal(selectInNumber(9), '0')
  assert.equal(selectInNumber(10), 'A')
  assert.equal(selectInNumber(35), 'Z')
  // 反例：把第 10 项写成 "10"（两位数）就必须被这条抓到。
  assert.notEqual(selectInNumber(9), '10')
  assert.notEqual(selectInNumber(10), '10')
})

test('顺序只认权重：置灰的行照样占号，乱序输入也会被排回去', () => {
  const rows = planSelectIn([target('e', 9.5), target('a', 0), target('c', 4, false), target('b', 1.001)])
  assert.deepEqual(rows.map(row => row.id), ['a', 'b', 'c', 'e'])
  assert.deepEqual(rows.map(row => row.number), ['1', '2', '3', '4'])
  // 置灰项不能因为"不可选"就从表里消失（SelectInAction.java:99-105 传的是 showDisabledActions=true）。
  assert.ok(rows.some(row => row.id === 'c' && !row.selectable), '不可选的目标被删掉了，而不是留着置灰')
  // 反例：如果哪天按"只排可选项"实现，'c' 会掉号 —— 这条判据保证它响。
  assert.notDeepEqual(planSelectIn([target('c', 4, false)]).length, 0)
})

test('同权重保持传入顺序（上游是稳定的 List.sort）', () => {
  const rows = planSelectIn([target('first', 4), target('second', 4)])
  assert.deepEqual(rows.map(row => row.id), ['first', 'second'])
})

test('助记符表大小写各登记一次，命中只看字母数字', () => {
  const rows = planSelectIn([target('a', 0), target('b', 1), target('c', 2)])
  const map = selectInMnemonics([...rows, { ...rows[2], number: 'A' }])
  assert.equal(map.get('A'), 'c')
  assert.equal(map.get('a'), 'c', '只登记大写就等于按小写键不响应（MnemonicsSearch.java:28-29 两行都 put）')
  assert.equal(selectInMnemonicHit(map, rows, '1', ''), 'a')
  assert.equal(selectInMnemonicHit(map, rows, '1', 'p'), null, '速度搜索框里有字时助记符必须让路（:37）')
  assert.equal(selectInMnemonicHit(map, rows, '/', ''), null, '非字母数字不抢键（:39）')
  assert.equal(selectInMnemonicHit(map, rows, 'Enter', ''), null)
  assert.equal(selectInMnemonicHit(map, rows, 'x', ''), null, '没登记过的键不该命中')
})

test('命中的必须还是可见且可选的行；置灰行按编号也不动', () => {
  const rows = planSelectIn([target('a', 0), target('b', 1, false)])
  const map = selectInMnemonics(rows)
  assert.equal(selectInMnemonicHit(map, rows, '2', ''), null, '不可选的目标没有可执行的动作（SelectInAction.java:171-176）')
  // 过滤后不在表里的行也不该被编号命中：'1' 此刻是 'b'，而 'b' 不可选。
  const onlySecond = filterSelectIn(rows, 'b')
  assert.equal(selectInMnemonicHit(map, onlySecond, '1', ''), null)
})

test('速度搜索：空串放行全部，大小写无关，命中后不重排', () => {
  const rows = planSelectIn([target('z', 0), target('a', 1)])
  assert.deepEqual(filterSelectIn(rows, '  ').map(row => row.id), ['z', 'a'])
  const labels = rows.map(row => row.id.toUpperCase())
  assert.deepEqual(filterSelectIn(rows, labels[0]).map(row => row.id), ['z'], '顺序必须还是权重顺序，不是相关度')
})

test('速度搜索按 MinusculeMatcher 的子序列（驼峰缩写能命中，SpeedSearch.java:158-166）', () => {
  const rows = planSelectIn([
    { id: 'project', label: 'Project View', weight: 0, selectable: true },
    { id: 'structure', label: 'File Structure', weight: 4, selectable: true },
    { id: 'navbar', label: 'Navigation Bar', weight: 8, selectable: true },
  ])
  assert.deepEqual(filterSelectIn(rows, 'pv').map(row => row.id), ['project'], '驼峰缩写 PV → Project View')
  assert.deepEqual(filterSelectIn(rows, 'fs').map(row => row.id), ['structure'])
  assert.deepEqual(filterSelectIn(rows, 'proj').map(row => row.id), ['project'], '子串行为保留')
  assert.deepEqual(filterSelectIn(rows, 'zzz'), [], '对不上就是空表')
})

test('上下键在可选行之间走，两端不回绕', () => {
  const rows = planSelectIn([target('a', 0), target('b', 1, false), target('c', 2)])
  assert.equal(moveSelectIn(rows, 0, 1), 2, '必须跳过置灰的中间行')
  assert.equal(moveSelectIn(rows, 2, -1), 0)
  assert.equal(moveSelectIn(rows, 0, -1), 0, '到顶不回绕')
  assert.equal(moveSelectIn(rows, 2, 1), 2, '到底不回绕')
  assert.equal(moveSelectIn([], -1, 1), -1)
})

// —— 出厂目标表的核对 ——————————————————————————————————————————————
// 表已搬进 `src/selectInTargets.ts`（`com.intellij.selectInTarget` EP 的 bundled 贡献），
// 所以这里直接问那份模块，不再从 editorSideViews 的源码里抠字面量（抠字面量一旦搬家就假绿）。
const targetSource = read('src/selectInTargets.ts')
const shippedBundled = bundledSelectInTargets()
const shipped = shippedBundled.map(entry => ({ id: entry.id, label: entry.label, weight: entry.weight }))

test('EP id 与上游 qualifiedName 逐字一致', () => {
  assert.equal(SELECT_IN_TARGET_EP, 'com.intellij.selectInTarget')
})

test('表里就是这六个落点，且声明顺序 == 权重升序（改一个数就会响）', () => {
  assert.deepEqual(shipped.map(row => row.id), ['project', 'structure', 'navbar', 'commit', 'explorer', 'settings'])
  const weights = shipped.map(row => row.weight)
  assert.deepEqual([...weights].sort((a, b) => a - b), weights, '声明顺序与权重不一致 —— 上游只认权重（SelectInManager.java:23-27）')
  // 逐个权重都指到 StandardTargetWeights.java 的行；默认权重 0 = SelectInTarget.java:49-51。
  assert.deepEqual(weights, [0, 4, 8, 9, 9.5, 10])
  // 反例：把资源管理器的权重从 9.5 改成 0.5，它的**位置必须跟着动**（从第 5 行升到第 2 行）——
  // 这证明顺序是权重算出来的，不是数组字面量的书写顺序（上游只认 getWeight()）。
  const reshuffled = planSelectIn(shipped.map(row => ({ ...row, selectable: true, weight: row.id === 'explorer' ? 0.5 : row.weight })))
  assert.deepEqual(reshuffled.map(row => row.id), ['project', 'explorer', 'structure', 'navbar', 'commit', 'settings'],
    '改权重不动顺序 —— 排序根本没按权重走')
})

test('六个标题各对各的上游字面量，且都是本仓真有落点的目标', () => {
  assert.deepEqual(Object.fromEntries(shipped.map(row => [row.id, row.label])), {
    project: '项目视图',      // ProjectConceptBundle.properties:12 "Project View"
    structure: '文件结构',    // IdeBundle.properties:305 "File Structure"
    navbar: '导航栏',         // IdeBundle.properties:261 "Navigation Bar"
    commit: '提交',           // ChangesViewManager.kt:360-368 → 本地更改工具窗口的标题
    explorer: '在资源管理器中显示', // ActionsBundle.properties:1937 "Show in {0}" + IdeBundle:3209 "Explorer"
    settings: '项目结构',     // JavaUiBundle.properties:25 "Project Structure"
  })
  // 书签目标**故意不做**：上游 canSelect 只认 FileBookmark（BookmarksSelectInTarget.kt:26-33），
  // 本仓的书签全是行书签。写进来就是一条永远灰着、还谎称对齐上游的行。
  assert.doesNotMatch(targetSource, /id: 'bookmarks'/)
  // 每一项都必须有真落点，不能只有表没有动作：bundled 目标自带 `selectIn`，宿主在
  // `src/editorSideViews.ts` 里把副作用回调给齐（不是把动作写死在目标表里）。
  for (const entry of shippedBundled) assert.equal(typeof entry.selectIn, 'function', `${entry.id} 没有 selectIn`)
  assert.match(sideViews, /selectProjectView: \(\) => selectInTree\(\)/)
  assert.match(sideViews, /showNavBar: \(\) => showNavBar\(\)/)
  assert.match(sideViews, /openProjectStructure: \(\) => openProjectStructure\?\.\(\)/)
  assert.match(sideViews, /focusToolWindow: id => focusToolWindow\?\.\(id\)/)
  assert.match(sideViews, /request\('shell\.reveal'|request\('file\.reveal'/, '资源管理器那一项必须真的调原生 reveal')
})

test('编号画在独立的一列里，不是塞进文案', () => {
  // PopupListElementRenderer.java:363-369：myMnemonicLabel 是**单独的标签**，
  // 并且会把文案里的助记符下划线关掉 —— 所以 "1. 项目视图" 这种写法是错的。
  assert.match(popup, /<span class="select-in-number"[^>]*>\{\{ row\.number \}\}<\/span>/)
  assert.doesNotMatch(popup, /\$\{row\.number\}\. |number \+ '\. '/, '编号被拼进文案了（上游是独立一列）')
  assert.match(popup, /aria-hidden="true"/, '编号列是键盘提示，不该被读屏重复念出')
  // 数字键命中后必须吞掉事件，否则全局键位会把它当成别的（MnemonicsSearch.java:44 `e.consume()`）。
  assert.match(popup, /if \(hit\) \{ event\.preventDefault\(\); emit\('pick', hit\); return \}/)
  assert.match(popup, /@keydown\.stop="onKeydown"/, '弹窗内的按键不该再冒到全局键位')
})

test('编号列的颜色是上游的回退值，两档主题各一个，且没被 AA 文本色顶替', () => {
  // JBUI.java:1635-1636 → :393：Popup.mnemonicForeground 缺省回退 Component.infoForeground →
  // new JBColor(Gray.x99, Gray.x78)（Gray.java:457 _153 = #999999、:424 _120 = #787878）。
  const primitive = name => {
    const light = tokens.match(new RegExp(`--m-pop-${name}:\\s*(#[\\da-f]{6});`))
    const dark = [...tokens.matchAll(new RegExp(`--m-pop-${name}:\\s*(#[\\da-f]{6});`, 'g'))][1]
    assert.ok(light && dark, `--m-pop-${name} 必须两档都有`)
    return { light: light[1], dark: dark[1] }
  }
  const mnemonic = primitive('mnemonic')
  assert.deepEqual(mnemonic, { light: '#999999', dark: '#787878' })
  // 反例：这一列**不**是 --m-pop-info（那是补全的信息列颜色，两档都为了 AA 调过）。
  assert.notEqual(mnemonic.light, primitive('info').light)
  assert.match(tokens, /--popup-mnemonic: var\(--m-pop-mnemonic\)/, '语义层没把编号色接出去')
  assert.match(read('src/style.css'), /\.select-in-number \{[^}]*var\(--popup-mnemonic\)/)
  // 选中行改用选中前景（PopupListElementRenderer.java:366）。
  assert.match(read('src/style.css'), /\.select-in-row\.is-selected \.select-in-number \{ color: inherit; \}/)
})
