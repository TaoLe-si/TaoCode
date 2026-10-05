// 面包屑的符号层级（`src/breadcrumbs.ts`）：路径段 + 光标符号链 + 兄弟下拉 + 键盘移动。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  activeSegmentIndex, crumbClickAction, moveSegment, pathBreadcrumbSegments, popupSelectionAction, segmentTarget,
  siblingCandidates, symbolBreadcrumbs, typeLevelSymbolsOnly,
} from '../src/breadcrumbs.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const symbol = (name, kind, startLine, endLine) => ({ name, kind, detail: '', startLine, startChar: 0, endLine, endChar: 0 })

test('路径段：目录逐级 + 文件名，Windows 分隔符归一', () => {
  assert.deepEqual(pathBreadcrumbSegments('src/main/App.java').map(segment => [segment.kind, segment.name]),
    [['path', 'src'], ['path', 'main'], ['file', 'App.java']])
  assert.deepEqual(pathBreadcrumbSegments('src\\main\\App.java').map(segment => segment.path),
    ['src', 'src/main', 'src/main/App.java'])
  assert.deepEqual(pathBreadcrumbSegments('App.java').map(segment => segment.kind), ['file'])
})

test('符号链：光标处的作用域按语言过滤、外层在前', () => {
  const outline = [symbol('A', 5, 0, 20), symbol('field', 8, 2, 2), symbol('m', 6, 5, 10)]
  const segments = symbolBreadcrumbs('src/A.java', outline, 7, 'java')
  assert.deepEqual(segments.map(segment => segment.name), ['src', 'A.java', 'A', 'm'])
  assert.equal(segments[3].kind, 'symbol')
  assert.deepEqual(symbolBreadcrumbs('src/A.java', outline, 3, 'java').map(segment => segment.name), ['src', 'A.java', 'A'], '字段不进面包屑')
})

test('段目标：路径段给路径，符号段给行号，没区间的符号段不可点', () => {
  assert.deepEqual(segmentTarget({ kind: 'path', name: 'src', path: 'src' }), { path: 'src' })
  assert.deepEqual(segmentTarget({ kind: 'symbol', name: 'm', startLine: 5 }), { line: 5 })
  assert.equal(segmentTarget({ kind: 'symbol', name: 'x' }), null)
})

test('兄弟下拉：顶层只列顶层（嵌套方法不混进来）', () => {
  const outline = [symbol('A', 5, 0, 10), symbol('m', 6, 2, 4), symbol('B', 5, 12, 20)]
  const siblings = siblingCandidates(outline, { kind: 'symbol', name: 'A', startLine: 0 }, null, 'java')
  assert.deepEqual(siblings.map(item => item.name), ['B'])
  const withSelf = siblingCandidates(outline, { kind: 'symbol', name: 'A', startLine: 0 }, null, 'java', true)
  assert.deepEqual(withSelf.map(item => item.name), ['A', 'B'])
})

test('兄弟下拉：类里的方法列表不含类本身，也不含更深一层', () => {
  const outline = [symbol('A', 5, 0, 30), symbol('m1', 6, 2, 4), symbol('m2', 6, 6, 8), symbol('Inner', 5, 10, 20), symbol('deep', 6, 12, 14)]
  const siblings = siblingCandidates(outline, { kind: 'symbol', name: 'm1', startLine: 2 }, { kind: 'symbol', name: 'A', startLine: 0, endLine: 30 }, 'java')
  assert.deepEqual(siblings.map(item => item.name), ['m2', 'Inner'], '类本身与 Inner 里的 deep 都不在方法列表里')
  const inner = siblingCandidates(outline, { kind: 'symbol', name: 'deep', startLine: 12 }, { kind: 'symbol', name: 'Inner', startLine: 10, endLine: 20 }, 'java')
  assert.deepEqual(inner.map(item => item.name), [])
})

test('键盘移动：不环绕，到头上就停；活动段是最内层符号段', () => {
  assert.equal(moveSegment(1, 1, 4), 2)
  assert.equal(moveSegment(0, -1, 4), 0)
  assert.equal(moveSegment(3, 1, 4), 3)
  assert.equal(moveSegment(0, 1, 0), -1)
  const segments = pathBreadcrumbSegments('a/b.ts').concat([{ kind: 'symbol', name: 'f', startLine: 1 }])
  assert.equal(activeSegmentIndex(segments), 2)
  assert.equal(activeSegmentIndex(pathBreadcrumbSegments('a/b.ts')), 1, '没有符号段时活动段是文件')
})

test('点段：单击弹下拉、双击才导航（NavBarItemComponent.kt:134-143）', () => {
  assert.equal(crumbClickAction(1), 'popup', '单击是 vm.select() + vm.showPopup()，不是跳转')
  assert.equal(crumbClickAction(2), 'navigate', '双击才是 vm.activate()')
  assert.equal(crumbClickAction(3), 'navigate')
})

test('下拉里选一项：能导航就导航，否则开下一层；没有子项时一律导航（NavBarItemExpandResult.kt:12-15）', () => {
  assert.equal(popupSelectionAction(true, true), 'navigate')
  assert.equal(popupSelectionAction(true, false), 'navigate')
  assert.equal(popupSelectionAction(false, true), 'nextPopup')
  assert.equal(popupSelectionAction(false, false), 'navigate', '没有 children 时不看 navigateOnClick')
})

// 「符号层只显示到类型层」的开关（`UISettings.showMembersInNavigationBar`）：
//   · `java/java-impl/src/com/intellij/ide/navigationToolbar/JavaNavBarExtension.java:103` ——
//     关掉时成员（方法/字段）不进导航条，返回它所在的 `PsiClass`；同文件 `:107` 再关一档就退回文件；
//   · `java/java-impl/src/com/intellij/lang/java/JavaBreadcrumbsInfoProvider.java:125` ——
//     `isShownByDefault() = !getShowMembersInNavigationBar()`；
//   · 默认值 true：`platform/editor-ui-api/src/com/intellij/ide/ui/UISettingsState.kt:121`
//     （本仓那份在 `src/settingsModel.ts` 的 `defaultEditorSettings`）。
// 本仓的等价实现是 `typeLevelSymbolsOnly`：符号链里只留 Class/Enum/Interface/Struct（5/10/11/23）。
test('showMembers 关掉：符号链只到类型层，兄弟下拉只列类', () => {
  const outline = [symbol('A', 5, 0, 20), symbol('m', 6, 5, 10), symbol('B', 11, 22, 30)]
  assert.deepEqual(symbolBreadcrumbs('src/A.java', outline, 7, 'java', true).map(s => s.name), ['src', 'A.java', 'A', 'm'])
  assert.deepEqual(symbolBreadcrumbs('src/A.java', outline, 7, 'java', false).map(s => s.name), ['src', 'A.java', 'A'])
  assert.deepEqual(symbolBreadcrumbs('src/A.java', outline, 7, 'java').map(s => s.name), ['src', 'A.java', 'A', 'm'],
    '缺省 = true：宿主没传时与改前一模一样')
  // 四类都算类型层（与「转到类」同一份常量，`src/lspSymbolBridge.ts:58`）
  assert.deepEqual(symbolBreadcrumbs('src/E.java', [symbol('E', 10, 0, 9), symbol('e', 22, 1, 1)], 1, undefined, false).map(s => s.name),
    ['src', 'E.java', 'E'])
  const mixed = [symbol('A', 5, 0, 10), symbol('m', 6, 2, 4), symbol('B', 5, 12, 20)]
  assert.deepEqual(siblingCandidates(mixed, { kind: 'symbol', name: 'A', startLine: 0 }, null, 'java', true, false).map(s => s.name),
    ['A', 'B'], '兄弟下拉列的是同层的类，不是方法')
  assert.deepEqual(typeLevelSymbolsOnly(mixed, true).map(s => s.name), ['A', 'm', 'B'])
  assert.deepEqual(typeLevelSymbolsOnly(mixed, false).map(s => s.name), ['A', 'B'])
})

// 组件侧的消费：`BreadcrumbsBar.vue` 的 `show-members` 属性（宿主绑定是接线请求，App.vue 冻结）。
test('接线：BreadcrumbsBar 把这一档传到规则层', () => {
  const bar = readFileSync(join(root, 'src/components/BreadcrumbsBar.vue'), 'utf8')
  assert.match(bar, /showMembers\?: boolean/)
  assert.match(bar, /props\.showMembers \?\? true/, '符号链与兄弟下拉两处都要传')
  assert.equal((bar.match(/props\.showMembers \?\? true/g) ?? []).length, 2)
})
