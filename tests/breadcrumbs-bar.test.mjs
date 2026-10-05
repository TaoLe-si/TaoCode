// 面包屑整行（`src/components/BreadcrumbsBar.vue`）的接线门禁。
//
// 这个组件把上一轮那四个「只有测试消费」��模块真正装到 DOM 上：
// `src/breadcrumbs.ts`（符号链/段跳转/兄弟下拉/点段语义）、`src/navToolbarCrumbs.ts`（四档背景键）、
// `src/navToolbarPresentation.ts`（navigateOnClick）、`src/navBarModel.ts`（NavBarElement 形状）。
// 组件本身等着桶 8 在 App.vue 里换掉内联模板（见报告的接线请求），所以这里断言的是**接线面**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src/components/BreadcrumbsBar.vue'), 'utf8')

test('四个规则模块都被这个组件真的 import 并调用（不是只 import）', () => {
  for (const [name, called] of [
    ['breadcrumbs', ['symbolBreadcrumbs(', 'segmentTarget(', 'siblingCandidates(', 'moveSegment(', 'popupSelectionAction(']],
    ['navToolbarCrumbs', ['crumbStates(', 'crumbColorKeys(', 'CRUMB_TOKEN_CLASS[']],
    ['navToolbarPresentation', ['navBarNavigatesOnClick(']],
    ['navBarModel', ['NavBarElement']],
  ]) {
    assert.match(source, new RegExp(`from '\\.\\./${name}'`), `import ${name}`)
    for (const call of called) assert.ok(source.includes(call), `${name} 的 ${call} 没被调用`)
  }
})

test('点段语义照抄上游：单击弹下拉、双击激活', () => {
  // NavBarItemComponent.kt:134-139 / :140-143
  assert.match(source, /@click="openPopup\(index\)"/, '单击走 openPopup（select + showPopup）')
  assert.match(source, /@dblclick="activateAt\(index\)"/, '双击走 activate')
})

test('四档背景键既落 class 也落 data-color-key（class 未进 style.css 时仍可核）', () => {
  assert.match(source, /:data-color-key="colorKeys\[index\]"/)
  assert.match(source, /CRUMB_TOKEN_CLASS\[colorKeys\.value\[index\]/)
})

test('行号是 1 基（与 createStickyLines 的 currentLine 同口径），进符号层前减 1', () => {
  assert.match(source, /Math\.max\(0, \(props\.line \?\? 1\) - 1\)/)
})

test('不写裸 hex / 毫秒 / cubic-bezier，图标尺寸走 iconSize 阶梯', () => {
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, '禁裸 hex')
  assert.doesNotMatch(source, /\d+ms\b/, '禁硬编码毫秒')
  assert.doesNotMatch(source, /cubic-bezier/, '禁硬编码缓动')
  assert.match(source, /:size="iconSize\.dense"/)
  // 纯图标必须带 title/aria-label；这里图标是行内装饰，跟着文字走。
  assert.match(source, /from 'lucide-vue-next'/)
})

// 门禁：取证坐标写在文件头，参考树在本机时要真的引得到。
test('取证：组件头引的上游路径存在', () => {
  const ref = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
  // 文件头引了四个上游文件，逐个核。
  for (const relative of [
    'platform/navbar/frontend/src/ui/NavBarItemComponent.kt',
    'platform/navbar/backend/src/NavBarItem.kt',
    'platform/navbar/backend/src/impl/DefaultNavBarItem.kt',
    'platform/navbar/shared/src/NavBarItemExpandResult.kt',
    'platform/navbar/frontend/resources/intellij.platform.navbar.frontend.xml',
  ]) {
    if (!source.includes(relative.split('/').pop())) continue
    assert.ok(readFileSync(join(ref, relative), 'utf8').length > 0, relative)
  }
})
