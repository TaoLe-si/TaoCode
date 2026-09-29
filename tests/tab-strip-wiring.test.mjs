// 标签条溢出的**接线**机检。
//
// 起因（2026-09-29 用户实测）："上边栏文件打开超过一定数量就看不到后面的 tab 了"。
// 布局算法（src/tabStripLayout.ts + src/tabStripView.ts）早就照 `ScrollableSingleRowLayout`
// 写全了：谁被裁、谁被挤出、`…` 该不该出现都算得出来 —— 但 App.vue 的模板**一个都没消费**：
// 没有 `…` 按钮、没有按算出的宽度落 style、`.editor-tabs` 又是 `overflow: hidden`，
// 于是挤不下的标签直接消失且没有任何入口。算法在、接线断了，单测全绿也照样坏。
//
// 上游形状：`ScrollableSingleRowLayout` 处理溢出有两半 —— 裁切 + **滚动**。第一半（`…` 弹窗
// = `JBTabsImpl.showMorePopup()`，platform-api/.../jbTabs/impl/JBTabsImpl.kt:1089-1098）先接过，
// 2026-09-29 用户实测后换成第二半：滚轮监听（:570-577）与每次布局把选中项滚进可视区
// （ScrollableSingleRowLayout.java:105-111 → :68-103）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const app = read('src/App.vue')
const view = read('src/tabStripView.ts')
const css = read('src/style.css')

test('模板把标签条元素交给测量模块（不然 strip 宽度永远是 0）', () => {
  assert.match(app, /class="editor-tabs"[^>]*:ref="element => registerTabStrip\(pane, element\)"/,
    '没有注册标签条元素：recomputeTabStrip 拿不到 strip，直接 return，布局永远是 null')
})

test('每个标签都用算出来的宽度渲染，被挤出的那个宽度归零', () => {
  // v-for 必须带 index —— 位置是按序号算的，只拿 tab 对象对不上布局条目。
  assert.match(app, /v-for="\(tab, index\) in groups\[pane\]\.tabs"/, 'file-tab 的 v-for 没有暴露 index')
  assert.match(app, /class="file-tab"[^>]*:style="\[[^\]]*tabWidthStyle\(pane, index\)/,
    '没把 placed.width 写进 style：标签各自按自然宽度排，溢出的是整条 flex 行')
  assert.match(view, /if \(isTabDropped\(pane, index\)\) return \{ width: '0px'/,
    '被挤出的标签要给零尺寸（源码的 layoutStopped），不是留在行里占位')
  // 反证：源码若写成 display:none，测量就会拿到 0 且**不缓存**，下一轮改用 50px 兜底，
  // 需求长度骤降 → 标签又回来 → 反复抖动。这条判据保证不会退回那种写法。
  assert.doesNotMatch(view, /isTabDropped[^}]*display: none/, '用 display:none 隐藏会让宽度测量自欺')
})

test('溢出不给「…」留位：模板不画按钮，布局预留 0', () => {
  // 用户实测（2026-09-29）："顶部文件打开栏不应该是...，应该改为可滚动"。
  // 上游本来就给了第二条路：`JBTabsImpl.kt:570-577` 的滚轮监听 + `doScrollToSelectedTab`，
  // 而「…」那一侧的预留宽度可以是 0（`getMoreRectAxisSize()` 在 New UI 侧边标签就是 0，
  // ScrollableSingleRowLayout.java:167-172）。这里取前者、去掉后者。
  assert.doesNotMatch(app, /tab-more|TabMoreMenu/, '模板里不该再有「…」按钮或它的弹窗组件')
  assert.doesNotMatch(app, /openTabMore/, '按钮的入口函数已经随按钮一起删掉')
  assert.match(view, /moreButtonWidth: 0/, '布局必须按「不预留」算：预留了宽度就会白白截掉一条标签')
  // 反证：把预留改回非 0 的写法必须被这条抓到。
  assert.ok(!/moreButtonWidth: 0/.test('moreButtonWidth: tabMoreButtonWidth.value'), '反例本该不合格')
})

test('滚动：滚轮接在标签条上，偏移真的落到样式里', () => {
  assert.match(app, /@wheel="onTabStripWheel\(pane, \$event\)"/, '标签条没接滚轮 = 溢出还是没有出口')
  assert.match(view, /event\.deltaY !== 0 \? event\.deltaY : event\.deltaX/,
    '上游给水平标签补 SHIFT_DOWN_MASK（JBTabsImpl.kt:572），竖向滚轮要能横滚；触控板只给 deltaX')
  assert.match(view, /maxScrollOffset <= 0\) return/, '放不下时不该 preventDefault，也不该吞掉滚动')
  assert.match(view, /event\.preventDefault\(\)/, '接了滚动就要拦住页面自己的滚动')
  assert.match(view, /tabScrollOffsets\.value\[pane\][\s\S]*recomputeTabStrip\(pane\)/,
    'scroll(units) 之后必须重算，否则偏移只写在状态里')
  // 偏移不落到 style 上就只是"算出来了"，屏幕上一动不动 —— 这次事故的原始形状。
  assert.match(view, /marginLeft: `\$\{-offset\}px`/, '第一条的负左边距就是 getStartPosition - getScrollOffset')
  assert.match(app, /:style="\[[^\]]*tabWidthStyle\(pane, index\)/, '偏移要经过 tabWidthStyle 进模板')
})

test('切换选中的标签会把它滚进可视区，鼠标在条上时不抢', () => {
  assert.match(view, /scrollUnitsToShowTab/, '选中项的滚动 = 上游 recomputeToLayout → doScrollToSelectedTab（:105-111）')
  assert.match(view, /if \(!tabStripHovers\[pane\]\)/, '鼠标在标签条上时必须跳过自动滚动（:69-71 的 isMouseInsideTabsArea）')
  assert.match(app, /@pointerenter="setTabStripHover\(pane, true\)" @pointerleave="setTabStripHover\(pane, false\)"/,
    '那个守卫的输入没人喂，就等于每次布局都会和用户抢偏移')
  // 只换选中项、不换标签集合，也要重算一次（上游是布局里做的）。
  assert.match(view, /groups\[0\]\.activePath, groups\[1\]\.activePath/, 'watch 的键里少了 activePath：切到裁掉的标签不会滚过来')
})

test('单行标签条不开浏览器原生滚动：overflow: hidden 必须盖掉前面的 overflow-x: auto', () => {
  // 滚动由 JS 的偏移实现（上游那条隐藏滚动条，`isWithScrollBar` false）；两套并存会互相打架。
  const scrolling = css.indexOf('.editor-tabs { display: flex')
  const clipped = css.indexOf('.editor-tabs { overflow: hidden; }')
  assert.ok(scrolling >= 0 && css.slice(scrolling, scrolling + 200).includes('overflow-x: auto'),
    '第一处规则本意是横向滚动 —— 靠后面那条盖掉')
  assert.ok(clipped > scrolling, '裁掉滚动的那条规则丢了或写在了前面（同特异性下会被前者覆盖）')
})
